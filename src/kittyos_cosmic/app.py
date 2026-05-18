from flask import Flask, render_template, request, jsonify
import sys
import os
import logging
import threading
import ast
import inspect
import importlib.util
from datetime import datetime
from dataclasses import asdict
from pathlib import Path

# Extension-relative root (used for sys.path); real project root is resolved via _framework_root()
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))
# Insert at 0 to prioritize local modules over site-packages
sys.path.insert(0, ROOT_DIR)


def _framework_root() -> str:
    """KittySploit project root: directory containing both ``lib/`` and ``core/``."""
    p = os.path.abspath(os.path.dirname(__file__))
    for _ in range(20):
        if os.path.isdir(os.path.join(p, 'lib')) and os.path.isdir(os.path.join(p, 'core')):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            break
        p = parent
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', '..'))

from kittysploit import Framework, print_info, print_success, print_error
from core.models.models import Host, Vulnerability, Workflow, WorkflowExecution
import json

# Flask-SocketIO for real-time communication
try:
    from flask_socketio import SocketIO, emit, join_room, leave_room
    SOCKETIO_AVAILABLE = True
except ImportError:
    SOCKETIO_AVAILABLE = False
    print_error("Flask-SocketIO not available. Install with: pip install flask-socketio")

app = Flask(__name__)
app.config['SECRET_KEY'] = 'kittysploit-secret-key-change-me'

# Initialize SocketIO
if SOCKETIO_AVAILABLE:
    socketio = SocketIO(app, cors_allowed_origins="*")
else:
    socketio = None

# Global Framework Instance
framework = None

# Real-time data stores
activity_feed = []  # Store recent activities (max 100)
active_users = {}   # Track connected users per session
credential_vault = []  # Store harvested credentials
chat_history = []      # Store team chat messages

# Module execution outputs for real-time streaming
module_outputs = {}  # Store module outputs by execution_id
module_outputs_lock = threading.Lock()

# IRC Bridge for real IRC connection
irc_bridge = None

# Proxy Manager for KittyProxy
from interfaces.web_ui.proxy_manager import ProxyManager
proxy_manager = None

# KittyCollab Server
collab_server = None
collab_server_thread = None
collab_server_port = 5006  # Use different port than main web UI (5005)

# Web Delivery Server
web_delivery_server = None
web_delivery_server_thread = None
web_delivery_server_port = 8080
web_delivery_file_path = None
web_delivery_random_path = None  # Random 4-letter path
web_delivery_running = False
web_delivery_job_id = None  # Job ID for web delivery server

# --- START TERMINAL BACKEND ---
from interfaces.command_system.command_registry import CommandRegistry
from core.output_handler import OutputHandler
from core.session import Session

# Global terminal components
command_registry = None
output_handler = None
init_lock = threading.Lock()
framework_init_lock = threading.Lock()
framework_initialized = False

def ensure_terminal_backend():
    global command_registry, output_handler, framework
    with init_lock:
        # Always try to use framework's output_handler if available
        if framework and hasattr(framework, 'output_handler') and framework.output_handler:
            output_handler = framework.output_handler
            if not output_handler.redirecting:
                output_handler.start_redirection()
        
        if command_registry:
            return

        print_info("Initializing Web Terminal Backend...")
        
        # 1. Setup Output Handler - Use framework's output_handler if available
        # Otherwise create a new one (but this should not happen if framework is initialized)
        if not output_handler:
            if framework and hasattr(framework, 'output_handler') and framework.output_handler:
                output_handler = framework.output_handler
                print_info("Using framework's output_handler instance")
            else:
                output_handler = OutputHandler()
                print_info("Created new output_handler instance (framework not available)")
        
        # 2. Setup Command Registry
        # We need a dummy session object for the registry context
        # (Though individual commands might use framework.current_module etc)
        cli_session = Session()
        
        command_registry = CommandRegistry(framework, cli_session, output_handler)
        
        # 3. Start Global Redirection (Captures all stdout/print)
        # Warning: This captures server logs too.
        # Only start if not already redirecting
        if not output_handler.redirecting:
            output_handler.start_redirection()
        
        # 4. Add a global callback to broadcast everything to 'terminal_output'
        # This makes it a shared "God Mode" console.
        # DISABLED to allow isolated terminal sessions
        # def broadcast_output(text):
        #     if socketio:
        #         # Remove color codes if desired, or keep them for xterm.js to render
        #         # For now we send raw text (xterm handles ANSI mostly)
        #         socketio.emit('terminal_output', {'text': text}, namespace='/')
                
        # output_handler.add_stdout_callback(broadcast_output)
        # output_handler.add_stderr_callback(broadcast_output)
        
        print_success("Web Terminal Backend Initialized")

def init_framework():
    global framework, irc_bridge, framework_initialized
    with framework_init_lock:
        if framework_initialized and framework:
            return framework
        
        try:
            print_info("Initializing Kittysploit Framework for Web UI...")
            framework = Framework()
            print_success("Framework initialized successfully.")
            
            # Initialize terminal backend after framework is ready
            ensure_terminal_backend()
            
            # Initialize IRC bridge for real IRC connections
            if SOCKETIO_AVAILABLE and socketio:
                from interfaces.web_ui.irc_bridge import WebIRCBridge
                irc_bridge = WebIRCBridge(socketio)
                print_success("IRC Bridge initialized (libera.chat #KittySploit)")
            
            # Initialize Proxy Manager
            global proxy_manager
            proxy_manager = ProxyManager(framework)
            print_success("Proxy Manager initialized")
            
            # Initialize workflow templates
            initialize_workflow_templates()
            
            framework_initialized = True
            return framework
            
        except Exception as e:
            print_error(f"Failed to initialize framework: {e}")
            import traceback
            traceback.print_exc()
            class DummyFramework:
                def __init__(self):
                    self.version = "Mock-1.0"
                    self.sessions = {}
            framework = DummyFramework()
            framework_initialized = True
            return framework
# --- END TERMINAL BACKEND ---

def initialize_workflow_templates():
    """Initialize default workflow templates in database"""
    try:
        if not framework or not framework.db_manager:
            return
        
        with framework.db_manager.session_scope('default') as session:
            # Get existing template names to avoid duplicates
            existing_templates = {t.name for t in session.query(Workflow).filter(Workflow.is_template == True).all()}
            
            templates = [
                {
                    'name': 'Reconnaissance et Exploitation Automatisée',
                    'description': 'Workflow complet : définition de variables, scan de ports, condition de succès, et exploitation',
                    'trigger': 'manual',
                    'template_category': 'recon',
                    'nodes': json.dumps([
                        # Start node
                        {'id': 'node_1', 'type': 'start', 'label': 'Start', 'x': 100, 'y': 200, 'color': {'border': '#ff7b72', 'background': '#161b22'}},
                        
                        # Variable: Target IP
                        {'id': 'node_2', 'type': 'variable', 'label': 'Set Target IP', 'variableName': 'target_ip', 'variableValue': '192.168.1.100', 'x': 300, 'y': 100, 'color': {'border': '#ec407a', 'background': '#161b22'}},
                        
                        # Variable: Ports to scan
                        {'id': 'node_3', 'type': 'variable', 'label': 'Set Ports', 'variableName': 'target_ports', 'variableValue': '80,443,22,3389', 'x': 300, 'y': 200, 'color': {'border': '#ec407a', 'background': '#161b22'}},
                        
                        # Variable: Timeout
                        {'id': 'node_4', 'type': 'variable', 'label': 'Set Timeout', 'variableName': 'scan_timeout', 'variableValue': '5', 'x': 300, 'y': 300, 'color': {'border': '#ec407a', 'background': '#161b22'}},
                        
                        # Delay before scan
                        {'id': 'node_5', 'type': 'delay', 'label': 'Delay 2s', 'delay': 2, 'x': 500, 'y': 200, 'color': {'border': '#ffa726', 'background': '#161b22'}},
                        
                        # Module: Port Scan
                        {'id': 'node_6', 'type': 'module', 'label': 'Port Scan', 'module': 'scanners/port_scan', 'options': {'target': '${target_ip}', 'ports': '${target_ports}', 'timeout': '${scan_timeout}'}, 'x': 700, 'y': 200, 'color': {'border': '#58a6ff', 'background': '#161b22'}},
                        
                        # Condition: Check if ports are open
                        {'id': 'node_7', 'type': 'condition', 'label': 'Ports Open?', 'expression': 'open_ports.length > 0', 'trueLabel': 'Yes', 'falseLabel': 'No', 'x': 900, 'y': 200, 'color': {'border': '#3fb950', 'background': '#161b22'}},
                        
                        # Module: Service Enum (if ports open)
                        {'id': 'node_8', 'type': 'module', 'label': 'Service Enum', 'module': 'enumerate/services', 'options': {'target': '${target_ip}', 'ports': '${open_ports}'}, 'x': 1100, 'y': 100, 'color': {'border': '#58a6ff', 'background': '#161b22'}},
                        
                        # Module: Exploit Attempt (if ports open)
                        {'id': 'node_9', 'type': 'module', 'label': 'Exploit', 'module': 'exploits/http_rce', 'options': {'target': '${target_ip}', 'port': '${open_ports[0]}'}, 'x': 1100, 'y': 200, 'color': {'border': '#58a6ff', 'background': '#161b22'}},
                        
                        # Variable: Store session
                        {'id': 'node_10', 'type': 'variable', 'label': 'Store Session', 'variableName': 'session_id', 'variableValue': '${session.id}', 'x': 1300, 'y': 200, 'color': {'border': '#ec407a', 'background': '#161b22'}},
                        
                        # Success node (end)
                        {'id': 'node_11', 'type': 'module', 'label': 'Success', 'module': 'post/shell', 'options': {'session': '${session_id}'}, 'x': 1500, 'y': 200, 'color': {'border': '#3fb950', 'background': '#161b22'}}
                    ]),
                    'edges': json.dumps([
                        {'id': 'edge_1', 'from': 'node_1', 'to': 'node_2'},
                        {'id': 'edge_2', 'from': 'node_1', 'to': 'node_3'},
                        {'id': 'edge_3', 'from': 'node_1', 'to': 'node_4'},
                        {'id': 'edge_4', 'from': 'node_2', 'to': 'node_5'},
                        {'id': 'edge_5', 'from': 'node_3', 'to': 'node_5'},
                        {'id': 'edge_6', 'from': 'node_4', 'to': 'node_5'},
                        {'id': 'edge_7', 'from': 'node_5', 'to': 'node_6'},
                        {'id': 'edge_8', 'from': 'node_6', 'to': 'node_7'},
                        {'id': 'edge_9', 'from': 'node_7', 'to': 'node_8', 'label': 'Yes'},
                        {'id': 'edge_10', 'from': 'node_7', 'to': 'node_9', 'label': 'Yes'},
                        {'id': 'edge_11', 'from': 'node_8', 'to': 'node_9'},
                        {'id': 'edge_12', 'from': 'node_9', 'to': 'node_10'},
                        {'id': 'edge_13', 'from': 'node_10', 'to': 'node_11'}
                    ]),
                    'steps': json.dumps([
                        {'action': 'variable', 'name': 'target_ip', 'value': '192.168.1.100'},
                        {'action': 'variable', 'name': 'target_ports', 'value': '80,443,22,3389'},
                        {'action': 'variable', 'name': 'scan_timeout', 'value': '5'},
                        {'action': 'delay', 'seconds': 2},
                        {'action': 'module', 'module': 'scanners/port_scan', 'options': {'target': '${target_ip}', 'ports': '${target_ports}'}},
                        {'action': 'condition', 'expression': 'open_ports.length > 0', 'on_success': 'service_enum', 'on_failure': 'end'},
                        {'action': 'module', 'module': 'enumerate/services', 'name': 'service_enum'},
                        {'action': 'module', 'module': 'exploits/http_rce'},
                        {'action': 'variable', 'name': 'session_id', 'value': '${session.id}'},
                        {'action': 'module', 'module': 'post/shell', 'name': 'success'}
                    ]),
                    'variables': json.dumps({
                        'target_ip': '192.168.1.100',
                        'target_ports': '80,443,22,3389',
                        'scan_timeout': '5'
                    })
                },
                {
                    'name': 'Windows Post-Exploitation',
                    'description': 'Automated post-exploitation workflow for Windows targets',
                    'trigger': 'platform:windows',
                    'template_category': 'post_exploit',
                    'nodes': json.dumps([
                        {'id': 'node_1', 'type': 'start', 'label': 'Start', 'x': 100, 'y': 100, 'color': {'border': '#ff7b72', 'background': '#161b22'}},
                        {'id': 'node_2', 'type': 'module', 'label': 'Host Enum', 'module': 'enumerate/host', 'options': {}, 'x': 300, 'y': 100, 'color': {'border': '#58a6ff', 'background': '#161b22'}},
                        {'id': 'node_3', 'type': 'module', 'label': 'GetSystem', 'module': 'privesc/getsystem', 'options': {}, 'x': 500, 'y': 100, 'color': {'border': '#58a6ff', 'background': '#161b22'}},
                        {'id': 'node_4', 'type': 'module', 'label': 'Dump Hashes', 'module': 'creds/dump_hashes', 'options': {}, 'x': 700, 'y': 100, 'color': {'border': '#58a6ff', 'background': '#161b22'}}
                    ]),
                    'edges': json.dumps([
                        {'id': 'edge_1', 'from': 'node_1', 'to': 'node_2'},
                        {'id': 'edge_2', 'from': 'node_2', 'to': 'node_3'},
                        {'id': 'edge_3', 'from': 'node_3', 'to': 'node_4'}
                    ]),
                    'steps': json.dumps([
                        {'action': 'module', 'module': 'enumerate/host'},
                        {'action': 'module', 'module': 'privesc/getsystem', 'condition': 'user != SYSTEM'},
                        {'action': 'module', 'module': 'creds/dump_hashes'}
                    ])
                },
                {
                    'name': 'Network Discovery',
                    'description': 'Automated network discovery and enumeration',
                    'trigger': 'manual',
                    'template_category': 'recon',
                    'nodes': json.dumps([
                        {'id': 'node_1', 'type': 'start', 'label': 'Start', 'x': 100, 'y': 100, 'color': {'border': '#ff7b72', 'background': '#161b22'}},
                        {'id': 'node_2', 'type': 'module', 'label': 'Network Scan', 'module': 'enumerate/network', 'options': {}, 'x': 300, 'y': 100, 'color': {'border': '#58a6ff', 'background': '#161b22'}},
                        {'id': 'node_3', 'type': 'module', 'label': 'Share Enum', 'module': 'enumerate/shares', 'options': {}, 'x': 500, 'y': 100, 'color': {'border': '#58a6ff', 'background': '#161b22'}}
                    ]),
                    'edges': json.dumps([
                        {'id': 'edge_1', 'from': 'node_1', 'to': 'node_2'},
                        {'id': 'edge_2', 'from': 'node_2', 'to': 'node_3'}
                    ]),
                    'steps': json.dumps([
                        {'action': 'module', 'module': 'enumerate/network'},
                        {'action': 'module', 'module': 'enumerate/shares'}
                    ])
                },
                {
                    'name': 'Linux Post-Exploitation',
                    'description': 'Automated post-exploitation workflow for Linux targets',
                    'trigger': 'platform:linux',
                    'template_category': 'post_exploit',
                    'nodes': json.dumps([
                        {'id': 'node_1', 'type': 'start', 'label': 'Start', 'x': 100, 'y': 100, 'color': {'border': '#ff7b72', 'background': '#161b22'}},
                        {'id': 'node_2', 'type': 'module', 'label': 'System Info', 'module': 'enumerate/host', 'options': {}, 'x': 300, 'y': 100, 'color': {'border': '#58a6ff', 'background': '#161b22'}},
                        {'id': 'node_3', 'type': 'module', 'label': 'SUID Check', 'module': 'privesc/suid', 'options': {}, 'x': 500, 'y': 100, 'color': {'border': '#58a6ff', 'background': '#161b22'}}
                    ]),
                    'edges': json.dumps([
                        {'id': 'edge_1', 'from': 'node_1', 'to': 'node_2'},
                        {'id': 'edge_2', 'from': 'node_2', 'to': 'node_3'}
                    ]),
                    'steps': json.dumps([
                        {'action': 'module', 'module': 'enumerate/host'},
                        {'action': 'module', 'module': 'privesc/suid'}
                    ])
                }
            ]
            
            created_count = 0
            for tpl_data in templates:
                # Only create template if it doesn't already exist
                if tpl_data['name'] not in existing_templates:
                    template = Workflow(
                        name=tpl_data['name'],
                        description=tpl_data['description'],
                        trigger=tpl_data['trigger'],
                        enabled=True,
                        is_template=True,
                        template_category=tpl_data.get('template_category'),
                        nodes=tpl_data['nodes'],
                        edges=tpl_data['edges'],
                        steps=tpl_data['steps'],
                        variables=tpl_data.get('variables', json.dumps({}))
                    )
                    session.add(template)
                    created_count += 1
            
            if created_count > 0:
                session.commit()
                print_success(f"Initialized {created_count} new workflow templates")
            else:
                print_info("All workflow templates already exist")
    except Exception as e:
        print_error(f"Error initializing workflow templates: {e}")

def start_rpc_server():
    """Start the XMLRPC server sharing the same framework instance"""
    from interfaces.rpc_server import RpcServer
    print_info("Starting RPC Server relay...")
    try:
        # Use a different port than the Flask app (e.g., 55553)
        rpc = RpcServer(framework, host='127.0.0.1', port=55553) 
        # rpc.start() runs serve_forever in a thread itself, but we should just call start()
        rpc.start() 
        print_success("RPC Server listening on 127.0.0.1:55553")
    except Exception as e:
        print_error(f"Failed to start RPC Server: {e}")

def start_collab_server():
    """Start the KittyCollab server in a separate thread"""
    global collab_server, collab_server_thread
    
    try:
        from interfaces.kittycollab.collab_server import CollabWebServer
        from werkzeug.serving import make_server
        
        print_info("Starting KittyCollab server...")
        collab_server = CollabWebServer(
            host='127.0.0.1',
            port=collab_server_port,
            verbose=False
        )
        
        # Create a non-blocking server using werkzeug
        def run_server():
            server = make_server('127.0.0.1', collab_server_port, collab_server.app, threaded=True)
            print_success(f"KittyCollab server started on http://127.0.0.1:{collab_server_port}")
            server.serve_forever()
        
        # Start server in a separate thread
        collab_server_thread = threading.Thread(
            target=run_server,
            daemon=True
        )
        collab_server_thread.start()
        
        # Give server time to start
        import time
        time.sleep(1)
        
    except Exception as e:
        print_error(f"Failed to start KittyCollab server: {e}")
        import traceback
        traceback.print_exc()

@app.route('/')
def index():
    return render_template('index.html', recent_activity=[])

@app.route('/os')
def os_desktop():
    return render_template('os_desktop.html')

@app.route('/agents')
def agents():
    return render_template('agents.html')

@app.route('/listeners')
def listeners():
    return render_template('listeners.html')

@app.route('/collab')
def collab():
    # Redirect to the real KittyCollab server
    from flask import redirect
    return redirect(f'http://127.0.0.1:{collab_server_port}/')

@app.route('/collab/<path:path>')
def collab_path(path):
    # Proxy requests to KittyCollab server
    from flask import redirect
    return redirect(f'http://127.0.0.1:{collab_server_port}/{path}')

@app.route('/editor')
def editor():
    return render_template('editor.html')

@app.route('/settings')
def settings():
    return render_template('settings.html')

@app.route('/credentials')
def credentials():
    return render_template('credentials.html')

@app.route('/automation')
def automation():
    return render_template('automation.html')

@app.route('/network')
def network_map():
    return render_template('network.html')

@app.route('/killchain')
def killchain():
    return render_template('killchain.html')

@app.route('/reporting')
def reporting():
    return render_template('reporting.html')

# Reporting API
@app.route('/api/reports/generate', methods=['POST'])
def generate_report():
    data = request.json
    title = data.get('title')
    format_type = data.get('format')
    sections = data.get('sections', {})
    
    # Mock report generation
    report = {
        'report_id': f"rpt-{int(datetime.now().timestamp())}",
        'title': title,
        'duration': '4h 32m',
        'hosts_compromised': 5,
        'credentials_found': 12,
        'findings': [
            {
                'title': 'Weak Password Policy',
                'description': 'Multiple user accounts use weak passwords susceptible to brute force attacks.',
                'severity': 'critical'
            },
            {
                'title': 'Unpatched Systems',
                'description': '3 systems are running outdated software with known vulnerabilities.',
                'severity': 'high'
            },
            {
                'title': 'Excessive Privileges',
                'description': 'Several user accounts have unnecessary administrative privileges.',
                'severity': 'high'
            }
        ],
        'mitre_techniques': ['T1190', 'T1059', 'T1082', 'T1078', 'T1003', 'T1046', 'T1021'],
        'recommendations': [
            'Implement strong password policy with minimum complexity requirements',
            'Deploy patch management system and ensure all systems are up-to-date',
            'Apply principle of least privilege to user accounts',
            'Enable multi-factor authentication for all administrative accounts',
            'Implement network segmentation to limit lateral movement'
        ]
    }
    
    add_activity('report_generated', f"Report '{title}' generated ({format_type})", 'System')
    
    return jsonify({'success': True, 'report': report, 'report_id': report['report_id']})

# Workflow Engine APIs - Now using database
@app.route('/api/workflows', methods=['GET'])
def api_workflows():
    """Get all workflows from database"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'workflows': []})
        
        workflows_list = []
        with framework.db_manager.session_scope('default') as session:
            workflows = session.query(Workflow).filter(Workflow.is_template == False).all()
            for wf in workflows:
                workflows_list.append(wf.to_dict())
        
        return jsonify({'workflows': workflows_list})
    except Exception as e:
        print_error(f"Error loading workflows: {e}")
        return jsonify({'workflows': []})

@app.route('/api/workflows/templates', methods=['GET'])
def api_workflow_templates():
    """Get workflow templates"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'templates': []})
        
        templates_list = []
        with framework.db_manager.session_scope('default') as session:
            templates = session.query(Workflow).filter(Workflow.is_template == True).all()
            for tpl in templates:
                templates_list.append(tpl.to_dict())
        
        return jsonify({'templates': templates_list})
    except Exception as e:
        print_error(f"Error loading templates: {e}")
        return jsonify({'templates': []})

@app.route('/api/workflows/templates/reinit', methods=['POST'])
def reinit_workflow_templates():
    """Force reinitialize workflow templates (admin function)"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'success': False, 'error': 'Database not available'}), 500
        
        with framework.db_manager.session_scope('default') as session:
            # Delete all existing templates
            session.query(Workflow).filter(Workflow.is_template == True).delete()
            session.commit()
        
        # Reinitialize templates
        initialize_workflow_templates()
        
        return jsonify({'success': True, 'message': 'Templates reinitialized'})
    except Exception as e:
        print_error(f"Error reinitializing templates: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/workflows/create', methods=['POST'])
def create_workflow():
    """Create a new workflow"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'success': False, 'error': 'Database not available'}), 500
        
        data = request.json
        name = data.get('name', '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'Workflow name is required'}), 400
        
        with framework.db_manager.session_scope('default') as session:
            # Check if name already exists
            existing = session.query(Workflow).filter(Workflow.name == name).first()
            if existing:
                return jsonify({'success': False, 'error': 'Workflow with this name already exists'}), 400
            
            new_wf = Workflow(
                name=name,
                description=data.get('description', ''),
                trigger=data.get('trigger', 'manual'),
                enabled=data.get('enabled', True),
                nodes=json.dumps(data.get('nodes', [])),
                edges=json.dumps(data.get('edges', [])),
                steps=json.dumps(data.get('steps', [])),
                variables=json.dumps(data.get('variables', {}))
            )
            session.add(new_wf)
            session.commit()
            
            add_activity('workflow_created', f"Workflow '{name}' created", 'System')
            return jsonify({'success': True, 'workflow_id': f"wf-{new_wf.id}"})
    except Exception as e:
        print_error(f"Error creating workflow: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/workflows/<wfid>/toggle', methods=['POST'])
def toggle_workflow(wfid):
    """Toggle workflow enabled status"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'success': False, 'error': 'Database not available'}), 500
        
        # Extract numeric ID from wf-{id} format
        try:
            wf_id = int(wfid.replace('wf-', ''))
        except:
            return jsonify({'success': False, 'error': 'Invalid workflow ID'}), 400
        
        with framework.db_manager.session_scope('default') as session:
            wf = session.query(Workflow).filter(Workflow.id == wf_id).first()
            if not wf:
                return jsonify({'success': False, 'error': 'Workflow not found'}), 404
            
            wf.enabled = not wf.enabled
            session.commit()
            return jsonify({'success': True, 'enabled': wf.enabled})
    except Exception as e:
        print_error(f"Error toggling workflow: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/workflows/<wfid>/execute', methods=['POST'])
def execute_workflow(wfid):
    """Execute a workflow"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'success': False, 'error': 'Database not available'}), 500
        
        # Extract numeric ID
        try:
            wf_id = int(wfid.replace('wf-', ''))
        except:
            return jsonify({'success': False, 'error': 'Invalid workflow ID'}), 400
        
        # Don't require Content-Type: application/json for empty/legacy clients
        data = request.get_json(silent=True) or {}
        target_session = data.get('target_session')
        
        with framework.db_manager.session_scope('default') as session:
            wf = session.query(Workflow).filter(Workflow.id == wf_id).first()
            if not wf:
                return jsonify({'success': False, 'error': 'Workflow not found'}), 404
            
            if not wf.enabled:
                return jsonify({'success': False, 'error': 'Workflow is disabled'}), 400
            
            # Create execution record
            execution = WorkflowExecution(
                workflow_id=wf.id,
                status='running',
                target_session=target_session,
                context=json.dumps(data.get('context', {}))
            )
            session.add(execution)
            wf.executions += 1
            wf.last_executed = datetime.utcnow()
            session.commit()
            
            exec_id = execution.id
            
            # Execute workflow in background thread
            if socketio:
                threading.Thread(
                    target=execute_workflow_background,
                    args=(wf_id, exec_id, target_session, data.get('context', {})),
                    daemon=True
                ).start()
            
            add_activity('workflow_exec', f"Workflow '{wf.name}' execution started", target_session or 'System')
            return jsonify({
                'success': True,
                'execution_id': exec_id,
                'message': 'Workflow execution started'
            })
    except Exception as e:
        print_error(f"Error executing workflow: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def execute_workflow_background(wf_id, exec_id, target_session, context):
    """Execute workflow in background thread"""
    try:
        if not framework or not framework.db_manager:
            return
        
        with framework.db_manager.session_scope('default') as session:
            wf = session.query(Workflow).filter(Workflow.id == wf_id).first()
            exec_record = session.query(WorkflowExecution).filter(WorkflowExecution.id == exec_id).first()
            
            if not wf or not exec_record:
                return
            
            # Load workflow structure
            nodes = json.loads(wf.nodes) if wf.nodes else []
            edges = json.loads(wf.edges) if wf.edges else []
            steps = json.loads(wf.steps) if wf.steps else []
            
            logs = []
            results = {}
            start_time = datetime.utcnow()
            
            # Simple execution logic (can be enhanced)
            if steps:
                for i, step in enumerate(steps):
                    step_name = step.get('module', f'Step {i+1}')
                    logs.append(f"[{datetime.utcnow().isoformat()}] Starting step: {step_name}")
                    
                    if socketio:
                        socketio.emit('workflow_progress', {
                            'execution_id': exec_id,
                            'workflow_id': wf_id,
                            'step': i + 1,
                            'total_steps': len(steps),
                            'step_name': step_name,
                            'status': 'running'
                        })
                    
                    # TODO: Actually execute the module here
                    # For now, simulate execution
                    import time
                    time.sleep(1)  # Simulate work
                    
                    results[f'step_{i+1}'] = {'status': 'completed', 'output': 'Simulated execution'}
                    logs.append(f"[{datetime.utcnow().isoformat()}] Step {step_name} completed")
            
            # Update execution record
            exec_record.status = 'completed'
            exec_record.completed_at = datetime.utcnow()
            exec_record.duration = int((datetime.utcnow() - start_time).total_seconds())
            exec_record.results = json.dumps(results)
            exec_record.logs = '\n'.join(logs)
            session.commit()
            
            if socketio:
                socketio.emit('workflow_completed', {
                    'execution_id': exec_id,
                    'workflow_id': wf_id,
                    'status': 'completed',
                    'duration': exec_record.duration
                })
    except Exception as e:
        print_error(f"Error in workflow execution: {e}")
        if framework and framework.db_manager:
            try:
                with framework.db_manager.session_scope('default') as session:
                    exec_record = session.query(WorkflowExecution).filter(WorkflowExecution.id == exec_id).first()
                    if exec_record:
                        exec_record.status = 'failed'
                        exec_record.error_message = str(e)
                        exec_record.completed_at = datetime.utcnow()
                        session.commit()
            except:
                pass

@app.route('/api/workflows/<wfid>', methods=['PUT'])
def update_workflow(wfid):
    """Update an existing workflow"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'success': False, 'error': 'Database not available'}), 500
        
        try:
            wf_id = int(wfid.replace('wf-', ''))
        except:
            return jsonify({'success': False, 'error': 'Invalid workflow ID'}), 400
        
        data = request.json
        with framework.db_manager.session_scope('default') as session:
            wf = session.query(Workflow).filter(Workflow.id == wf_id).first()
            if not wf:
                return jsonify({'success': False, 'error': 'Workflow not found'}), 404
            
            # Update fields
            if 'name' in data:
                wf.name = data['name']
            if 'description' in data:
                wf.description = data.get('description', '')
            if 'trigger' in data:
                wf.trigger = data.get('trigger', 'manual')
            if 'enabled' in data:
                wf.enabled = data['enabled']
            if 'nodes' in data:
                wf.nodes = json.dumps(data['nodes'])
            if 'edges' in data:
                wf.edges = json.dumps(data['edges'])
            if 'steps' in data:
                wf.steps = json.dumps(data['steps'])
            if 'variables' in data:
                wf.variables = json.dumps(data['variables'])
            
            wf.updated_at = datetime.utcnow()
            session.commit()
            
            add_activity('workflow_updated', f"Workflow '{wf.name}' updated", 'System')
            return jsonify({'success': True, 'workflow': wf.to_dict()})
    except Exception as e:
        print_error(f"Error updating workflow: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/workflows/<wfid>', methods=['DELETE'])
def delete_workflow(wfid):
    """Delete a workflow"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'success': False, 'error': 'Database not available'}), 500
        
        try:
            wf_id = int(wfid.replace('wf-', ''))
        except:
            return jsonify({'success': False, 'error': 'Invalid workflow ID'}), 400
        
        with framework.db_manager.session_scope('default') as session:
            wf = session.query(Workflow).filter(Workflow.id == wf_id).first()
            if not wf:
                return jsonify({'success': False, 'error': 'Workflow not found'}), 404
            
            wf_name = wf.name
            session.delete(wf)
            session.commit()
            
            add_activity('workflow_deleted', f"Workflow '{wf_name}' deleted", 'System')
            return jsonify({'success': True})
    except Exception as e:
        print_error(f"Error deleting workflow: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/workflows/<wfid>/executions', methods=['GET'])
def get_workflow_executions(wfid):
    """Get execution history for a workflow"""
    try:
        if not framework or not framework.db_manager:
            return jsonify({'executions': []})
        
        try:
            wf_id = int(wfid.replace('wf-', ''))
        except:
            return jsonify({'executions': []})
        
        limit = request.args.get('limit', 50, type=int)
        
        with framework.db_manager.session_scope('default') as session:
            executions = session.query(WorkflowExecution).filter(
                WorkflowExecution.workflow_id == wf_id
            ).order_by(WorkflowExecution.started_at.desc()).limit(limit).all()
            
            executions_list = [ex.to_dict() for ex in executions]
            return jsonify({'executions': executions_list})
    except Exception as e:
        print_error(f"Error loading executions: {e}")
        return jsonify({'executions': []})

# Python Workflow Conversion Functions
def parse_python_workflow(file_path):
    """Parse a Python workflow file and convert it to visual representation"""
    try:
        # Load the module
        spec = importlib.util.spec_from_file_location("workflow_module", file_path)
        if spec is None or spec.loader is None:
            return None
        
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        # Find the Workflow class
        workflow_class = None
        for name, obj in inspect.getmembers(module):
            if (inspect.isclass(obj) and 
                hasattr(obj, '__bases__') and 
                any('Workflow' in str(base) for base in obj.__bases__) and
                name != 'Workflow'):
                workflow_class = obj
                break
        
        if not workflow_class:
            return None
        
        # Get workflow info
        info = getattr(workflow_class, '__info__', {})
        workflow_name = info.get('name', 'Unknown Workflow')
        workflow_description = info.get('description', '')
        workflow_author = info.get('author', '')
        
        # Create a temporary instance to extract steps
        workflow_instance = workflow_class(framework)
        
        # Call run() to build the workflow steps
        try:
            workflow_instance.run()
        except:
            pass  # Some workflows might not have run() implemented
        
        # Convert steps to nodes and edges
        nodes = []
        edges = []
        step_name_to_node_id = {}
        node_counter = 1
        
        # Add start node
        start_node_id = f'node_{node_counter}'
        nodes.append({
            'id': start_node_id,
            'type': 'start',
            'label': 'Start',
            'x': 100,
            'y': 200,
            'color': {'border': '#ff7b72', 'background': '#161b22'}
        })
        node_counter += 1
        
        # Convert each step to a node
        for step_name, step in workflow_instance.steps.items():
            node_id = f'node_{node_counter}'
            step_name_to_node_id[step_name] = node_id
            
            # Determine node type and properties
            if hasattr(step, 'module_path') and step.module_path:
                node_type = 'module'
                node_label = step.name or step.module_path.split('/')[-1]
                node_data = {
                    'id': node_id,
                    'type': 'module',
                    'label': node_label,
                    # Preserve the original step name for round-trip export
                    'stepName': step.name,
                    'module': step.module_path,
                    'options': step.options or {},
                    'x': 300 + (node_counter - 2) * 200,
                    'y': 200,
                    'color': {'border': '#58a6ff', 'background': '#161b22'}
                }
                
                # Add condition if exists
                if step.condition:
                    node_data['condition'] = str(step.condition)

                # Preserve description if provided
                if getattr(step, "description", None):
                    node_data["description"] = step.description
                
                # Add input/output mappings as metadata
                if hasattr(step, 'input_mapping') and step.input_mapping:
                    node_data['inputMapping'] = step.input_mapping
                if hasattr(step, 'output_mapping') and step.output_mapping:
                    node_data['outputMapping'] = step.output_mapping
                
                nodes.append(node_data)
                node_counter += 1
        
        # Create edges based on on_success and on_failure
        if workflow_instance.start_step:
            start_step_node = step_name_to_node_id.get(workflow_instance.start_step)
            if start_step_node:
                edges.append({
                    'id': f'edge_start_{start_step_node}',
                    'from': start_node_id,
                    'to': start_step_node
                })
        
        for step_name, step in workflow_instance.steps.items():
            from_node = step_name_to_node_id.get(step_name)
            if not from_node:
                continue
            
            if step.on_success:
                to_node = step_name_to_node_id.get(step.on_success)
                if to_node:
                    edges.append({
                        'id': f'edge_{from_node}_{to_node}_success',
                        'from': from_node,
                        'to': to_node,
                        'label': 'Success'
                    })
            
            if step.on_failure and step.on_failure != 'workflow_end':
                to_node = step_name_to_node_id.get(step.on_failure)
                if to_node:
                    edges.append({
                        'id': f'edge_{from_node}_{to_node}_failure',
                        'from': from_node,
                        'to': to_node,
                        'label': 'Failure'
                    })
        
        return {
            'name': workflow_name,
            'description': workflow_description,
            'author': workflow_author,
            'nodes': nodes,
            'edges': edges,
            'file_path': file_path
        }
    except Exception as e:
        print_error(f"Error parsing Python workflow: {e}")
        import traceback
        traceback.print_exc()
        return None

def generate_python_workflow(workflow_data):
    """Generate Python workflow code from visual representation"""
    name = workflow_data.get('name', 'Generated Workflow')
    description = workflow_data.get('description', '')
    author = workflow_data.get('author', 'KittySploit')
    nodes = workflow_data.get('nodes', [])
    edges = workflow_data.get('edges', [])
    variables = workflow_data.get('variables', {})
    
    # Find start node
    start_node = next((n for n in nodes if n.get('type') == 'start'), None)
    if not start_node:
        return None

    def _sanitize_ident(s: str) -> str:
        s = (s or "").strip()
        if not s:
            s = "step"
        out = []
        for ch in s:
            out.append(ch if (ch.isalnum() or ch == "_") else "_")
        ident = "".join(out)
        if ident[0].isdigit():
            ident = f"_{ident}"
        return ident

    def _resolve_vars(value):
        """Replace '${var}' patterns when var exists in workflow variables."""
        if isinstance(value, str):
            if value.startswith("${") and value.endswith("}"):
                key = value[2:-1].strip()
                if key in variables:
                    return variables[key]
            return value
        if isinstance(value, list):
            return [_resolve_vars(v) for v in value]
        if isinstance(value, dict):
            return {k: _resolve_vars(v) for k, v in value.items()}
        return value

    # --- Build node_id -> step_id (WorkflowStep.name) mapping ---
    step_nodes = []
    node_id_to_step_id = {}
    used_step_ids = set()

    for node in nodes:
        ntype = node.get("type")
        if ntype in ("start", "variable"):
            continue
        node_id = node.get("id")
        if not node_id:
            continue

        base_step_id = (
            node.get("stepName")
            or node.get("step_id")
            or node.get("name")
            or node_id
        )
        base_step_id = _sanitize_ident(str(base_step_id))
        step_id = base_step_id
        suffix = 2
        while step_id in used_step_ids:
            step_id = f"{base_step_id}_{suffix}"
            suffix += 1

        used_step_ids.add(step_id)
        node_id_to_step_id[node_id] = step_id
        step_nodes.append(node)

    # --- Compute transitions based on edges ---
    outgoing = {}
    for e in edges:
        frm = e.get("from")
        to = e.get("to")
        if not frm or not to:
            continue
        outgoing.setdefault(frm, []).append(e)

    def _edge_kind(label: str) -> str:
        l = (label or "").strip().lower()
        if l in ("failure", "fail", "no", "false") or "fail" in l:
            return "failure"
        if l in ("success", "yes", "true"):
            return "success"
        # default bucket when no label / unknown label
        return "success"

    node_id_to_next = {}
    for node in step_nodes:
        nid = node.get("id")
        succ = None
        fail = None
        for e in outgoing.get(nid, []):
            kind = _edge_kind(e.get("label", ""))
            target_step_id = node_id_to_step_id.get(e.get("to"))
            if not target_step_id:
                continue
            if kind == "failure":
                if not fail:
                    fail = target_step_id
            else:
                if not succ:
                    succ = target_step_id
        node_id_to_next[nid] = (succ, fail)

    # Determine start step from start node edge (fallback: first step node)
    start_step_id = None
    for e in outgoing.get(start_node.get("id"), []):
        start_step_id = node_id_to_step_id.get(e.get("to"))
        if start_step_id:
            break
    if not start_step_id and step_nodes:
        start_step_id = node_id_to_step_id.get(step_nodes[0].get("id"))

    # --- Build Python code for steps ---
    final_steps = []
    for node in step_nodes:
        node_id = node.get("id")
        step_id = node_id_to_step_id.get(node_id)
        if not step_id:
            continue

        var_name = f"step_{_sanitize_ident(step_id)}"
        node_type = node.get("type")

        step_label = node.get("label") or step_id
        step_desc = node.get("description") or step_label

        on_success, on_failure = node_id_to_next.get(node_id, (None, None))

        if node_type == "module":
            module_path = node.get("module", "")
            options = _resolve_vars(node.get("options", {}) or {})

            step_code = f'        {var_name} = WorkflowStep(\n'
            step_code += f'            module_path="{module_path}",\n'
            if options:
                options_str = ', '.join([f'"{k}": {repr(v)}' for k, v in options.items()])
                step_code += f'            options={{{options_str}}},\n'
            step_code += f'            name="{step_id}",\n'
            step_code += f'            description="{step_desc}"'
            if on_success:
                step_code += f',\n            on_success="{on_success}"'
            if on_failure:
                step_code += f',\n            on_failure="{on_failure}"'
            step_code += '\n        )\n'

            # Add input/output mappings
            if node.get('inputMapping'):
                for ctx_key, mod_opt in node['inputMapping'].items():
                    step_code += f'        {var_name}.map_input("{ctx_key}", "{mod_opt}")\n'
            if node.get('outputMapping'):
                for mod_attr, ctx_key in node['outputMapping'].items():
                    step_code += f'        {var_name}.map_output("{mod_attr}", "{ctx_key}")\n'

            final_steps.append((var_name, step_code))

        elif node_type == "delay":
            delay = node.get('delay', 1)
            step_code = f'        {var_name} = WorkflowStep(\n'
            step_code += '            module_path="auxiliary/delay",\n'
            step_code += f'            options={{"seconds": {delay}}},\n'
            step_code += f'            name="{step_id}",\n'
            step_code += f'            description="Delay {delay} seconds"'
            if on_success:
                step_code += f',\n            on_success="{on_success}"'
            if on_failure:
                step_code += f',\n            on_failure="{on_failure}"'
            step_code += '\n        )\n'
            final_steps.append((var_name, step_code))

        elif node_type == "condition":
            expression = node.get('expression', '')
            step_code = f'        {var_name} = WorkflowStep(\n'
            step_code += '            module_path="auxiliary/condition",\n'
            step_code += f'            options={{"expression": {repr(expression)}}},\n'
            step_code += f'            name="{step_id}",\n'
            step_code += f'            description="Condition: {expression}"'
            if on_success:
                step_code += f',\n            on_success="{on_success}"'
            if on_failure:
                step_code += f',\n            on_failure="{on_failure}"'
            step_code += '\n        )\n'
            final_steps.append((var_name, step_code))
    
    # Generate Python code
    python_code = f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from kittysploit import *

class Module(Workflow):
    
    __info__ = {{
        'name': '{name}',
        'description': '{description}',
        'author': '{author}',
    }}
    
    def run(self):
'''
    if variables:
        python_code += '\n        # Workflow variables (resolved into options when possible)\n'
        for var_name, var_value in variables.items():
            python_code += f'        # {var_name} = {repr(var_value)}\n'
        python_code += '\n'
    
    # Add step definitions
    for step_var, step_code in final_steps:
        python_code += step_code
        python_code += f'        self.add_step({step_var})\n\n'
    
    # Set start step
    if start_step_id:
        python_code += f'        self.set_start_step("{start_step_id}")\n'
    
    return python_code

@app.route('/api/workflows/python/list', methods=['GET'])
def list_python_workflows():
    """List all Python workflow files"""
    try:
        workflow_dir = os.path.join(_framework_root(), 'modules', 'workflow')
        workflows = []
        
        if os.path.exists(workflow_dir):
            for filename in os.listdir(workflow_dir):
                if filename.endswith('.py') and filename != '__init__.py':
                    file_path = os.path.join(workflow_dir, filename)
                    workflow_info = parse_python_workflow(file_path)
                    if workflow_info:
                        workflow_info['filename'] = filename
                        workflows.append(workflow_info)
        
        return jsonify({'workflows': workflows})
    except Exception as e:
        print_error(f"Error listing Python workflows: {e}")
        return jsonify({'workflows': []})

@app.route('/api/workflows/python/load', methods=['POST'])
def load_python_workflow():
    """Load a Python workflow and convert it to visual format"""
    try:
        data = request.json
        filename = data.get('filename')
        
        if not filename:
            return jsonify({'success': False, 'error': 'Filename required'}), 400
        
        file_path = os.path.join(_framework_root(), 'modules', 'workflow', filename)
        
        if not os.path.exists(file_path):
            return jsonify({'success': False, 'error': 'File not found'}), 404
        
        workflow_data = parse_python_workflow(file_path)
        
        if not workflow_data:
            return jsonify({'success': False, 'error': 'Failed to parse workflow'}), 500
        
        return jsonify({'success': True, 'workflow': workflow_data})
    except Exception as e:
        print_error(f"Error loading Python workflow: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/workflows/python/generate', methods=['POST'])
def generate_python_workflow_file():
    """Generate Python workflow file from visual representation"""
    try:
        data = request.json
        workflow_data = data.get('workflow')
        filename = data.get('filename')
        
        if not workflow_data or not filename:
            return jsonify({'success': False, 'error': 'Workflow data and filename required'}), 400
        
        python_code = generate_python_workflow(workflow_data)
        
        if not python_code:
            return jsonify({'success': False, 'error': 'Failed to generate Python code'}), 500
        
        # Save to file
        workflow_dir = os.path.join(_framework_root(), 'modules', 'workflow')
        os.makedirs(workflow_dir, exist_ok=True)
        
        file_path = os.path.join(workflow_dir, filename)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(python_code)
        
        return jsonify({'success': True, 'file_path': file_path})
    except Exception as e:
        print_error(f"Error generating Python workflow: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# API
@app.route('/api/stats')
def api_stats():
    s_count = len(framework.sessions) if framework and hasattr(framework, 'sessions') else 0
    return jsonify({
        'agents': s_count, # Simplified
        'listeners': 0,
        'sessions': s_count
    })

@app.route('/api/agents')
def api_agents_list():
    agents = []
    if framework and hasattr(framework, 'sessions'):
         for sid, session in framework.sessions.items():
              agents.append({
                  'id': sid,
                  'platform': getattr(session, 'platform', 'Unknown'),
                  'hostname': getattr(session, 'info', 'Unknown'),
                  'user': getattr(session, 'username', 'Unknown'),
                  'status': 'active' if getattr(session, 'alive', True) else 'lost',
                  'last_seen': 'Now' 
              })
    
    # Mock for UI demo if empty
    if not agents:
        agents = [
             {"id": "demo-1", "platform": "Windows 11", "hostname": "WORKSTATION", "user": "SYSTEM", "status": "active"},
             {"id": "demo-2", "platform": "Linux", "hostname": "DB-SERVER", "user": "postgres", "status": "active"} 
        ]
    return jsonify({'agents': agents})

@app.route('/api/payloads')
def api_payloads():
    payloads = [
        {'name': 'Windows Generic', 'path': 'windows/shell_reverse_tcp', 'platform': ['Windows']},
        {'name': 'Linux Generic', 'path': 'linux/shell_bind_tcp', 'platform': ['Linux']}
    ]
    return jsonify({'payloads': payloads})

@app.route('/api/session/<sid>/exec', methods=['POST'])
def session_exec(sid):
    data = request.get_json(silent=True) or {}
    cmd = (data.get('command') or '').strip()
    
    if not cmd:
        return jsonify({'error': 'Command is required'}), 400
    
    if not framework:
        return jsonify({'error': 'Framework not initialized'}), 500
    
    session_manager = getattr(framework, 'session_manager', None)
    if not session_manager:
        return jsonify({'error': 'Session manager not available'}), 500
    
    shell_manager = getattr(framework, 'shell_manager', None)
    if not shell_manager:
        return jsonify({'error': 'Shell manager not available'}), 500
    
    # Helper to format output structure
    def format_result(result):
        output_text = result.get('output', '') if isinstance(result, dict) else ''
        if isinstance(result, dict) and result.get('error'):
            if output_text:
                output_text += '\n'
            output_text += f"Error: {result['error']}"
        return {
            'output': output_text,
            'status': (result.get('status') if isinstance(result, dict) else 0)
        }
    
    # Try to execute on a standard session
    session = session_manager.get_session(sid)
    if session:
        exec_result = shell_manager.execute_command(sid, cmd, framework=framework)
        return jsonify(format_result(exec_result))
    
    # Try browser session (JavaScript shell)
    browser_session = session_manager.get_browser_session(sid)
    if browser_session:
        browser_server = getattr(framework, 'browser_server', None)
        if not browser_server:
            return jsonify({'error': 'Browser server not running'}), 500
        
        shell = shell_manager.get_shell(sid)
        if not shell:
            shell = shell_manager.create_shell(
                session_id=sid,
                shell_type='javascript',
                session_type='browser',
                browser_server=browser_server
            )
            if not shell:
                return jsonify({'error': 'Unable to initialize JavaScript shell for this session'}), 500
        
        exec_result = shell.execute_command(cmd)
        return jsonify(format_result(exec_result))
    
    return jsonify({'error': 'Session not found'}), 404

@app.route('/api/session/<sid>/files')
def session_files(sid):
    path = request.args.get('path', 'C:\\')
    # Mock file listing
    files = [
        {'name': 'Users', 'path': 'C:\\Users', 'isDir': True, 'size': 0, 'modified': '2024-01-15'},
        {'name': 'Windows', 'path': 'C:\\Windows', 'isDir': True, 'size': 0, 'modified': '2024-01-10'},
        {'name': 'Program Files', 'path': 'C:\\Program Files', 'isDir': True, 'size': 0, 'modified': '2024-01-12'},
        {'name': 'secret.txt', 'path': 'C:\\secret.txt', 'isDir': False, 'size': 1024, 'modified': '2024-04-04'}
    ]
    return jsonify({'files': files})

@app.route('/api/session/<sid>/download')
def session_download(sid):
    path = request.args.get('path')
    # Mock download - in real implementation, stream file content from session
    return jsonify({'error': 'Download not yet implemented'}), 501

@app.route('/api/session/<sid>/upload', methods=['POST'])
def session_upload(sid):
    # Mock upload
    return jsonify({'success': False, 'error': 'Upload not yet implemented'}), 501

@app.route('/api/sessions', methods=['GET'])
def list_sessions():
    """List all sessions"""
    try:
        if framework and hasattr(framework, 'session_manager'):
            sm = framework.session_manager
            all_sessions = sm.get_all_sessions()
            
            sessions_list = []
            
            # Add standard sessions
            for session in all_sessions.get('standard', []):
                session_id = str(session.id)
                sessions_list.append({
                    'id': session_id,
                    'type': session.session_type,
                    'host': session.host,
                    'port': session.port,
                    'data': session.data,
                    'is_browser': False
                })
            
            # Add browser sessions
            for session in all_sessions.get('browser', []):
                info = session.get('info', {})
                session_id = (
                    session.get('id') or
                    session.get('session_id') or
                    session.get('victim_id') or
                    session.get('client_id') or
                    session.get('uuid') or
                    info.get('session_id') or
                    info.get('id')
                )
                
                if not session_id:
                    # Skip entries without an identifier to avoid frontend errors
                    print_error('Browser session without identifier skipped')
                    continue
                
                session_id = str(session_id)

                # Normalize fields (browser server implementations vary)
                ip = (
                    info.get('ip_address') or
                    info.get('ip') or
                    info.get('address') or
                    session.get('ip_address') or
                    session.get('ip') or
                    session.get('address') or
                    'Unknown'
                )
                browser_info = (
                    info.get('browser_info') or
                    session.get('browser_info') or
                    {}
                )
                sessions_list.append({
                    'id': session_id,
                    'type': 'browser',
                    'host': ip,
                    'port': 0,
                    'user_agent': info.get('user_agent', ''),
                    'platform': info.get('platform', ''),
                    'browser_info': browser_info,
                    'commands_executed': session.get('commands_executed', 0),
                    'active': session.get('active', True),
                    'first_seen': session.get('first_seen'),
                    'last_seen': session.get('last_seen'),
                    'is_browser': True
                })
            
            return jsonify({'sessions': sessions_list})
        else:
            return jsonify({'sessions': []})
    except Exception as e:
        print_error(f"Error listing sessions: {e}")
        return jsonify({'sessions': [], 'error': str(e)}), 500

@app.route('/api/sessions/<session_id>', methods=['GET'])
def get_session_details(session_id):
    """Get session details"""
    try:
        if framework and hasattr(framework, 'session_manager'):
            sm = framework.session_manager
            
            # Try standard session first
            session = sm.get_session(session_id)
            if session:
                return jsonify({
                    'id': str(session.id),
                    'type': session.session_type,
                    'host': session.host,
                    'port': session.port,
                    'data': session.data,
                    'is_browser': False
                })
            
            # Try browser session
            browser_session = sm.get_browser_session(session_id)
            if browser_session:
                info = browser_session.get('info', {})
                b_session_id = (
                    browser_session.get('id') or
                    browser_session.get('session_id') or
                    browser_session.get('victim_id') or
                    browser_session.get('client_id') or
                    browser_session.get('uuid') or
                    info.get('session_id') or
                    info.get('id')
                )
                if not b_session_id:
                    return jsonify({'error': 'Session identifier missing'}), 404

                ip = (
                    info.get('ip_address') or
                    info.get('ip') or
                    info.get('address') or
                    browser_session.get('ip_address') or
                    browser_session.get('ip') or
                    browser_session.get('address') or
                    'Unknown'
                )
                browser_info = (
                    info.get('browser_info') or
                    browser_session.get('browser_info') or
                    {}
                )
                return jsonify({
                    'id': str(b_session_id),
                    'type': 'browser',
                    'host': ip,
                    'port': 0,
                    'user_agent': info.get('user_agent', ''),
                    'platform': info.get('platform', ''),
                    'browser_info': browser_info,
                    'commands_executed': browser_session.get('commands_executed', 0),
                    'active': browser_session.get('active', True),
                    'first_seen': browser_session.get('first_seen'),
                    'last_seen': browser_session.get('last_seen'),
                    'is_browser': True
                })
            
            return jsonify({'error': 'Session not found'}), 404
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error getting session details: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/kill', methods=['POST'])
def kill_session(session_id):
    """Kill a session"""
    try:
        if framework and hasattr(framework, 'session_manager'):
            sm = framework.session_manager
            # Try to remove standard session first
            success = sm.remove_session(session_id)
            if not success:
                # Try browser session
                success = sm.remove_browser_session(session_id)
            
            if success:
                add_activity('session_killed', f"Killed session {session_id[:8]}...", 'System')
                return jsonify({'success': True})
            else:
                return jsonify({'error': 'Session not found or already killed'}), 404
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error killing session: {e}")
        return jsonify({'error': str(e)}), 500

# Browser Server API
@app.route('/api/browser_server/status', methods=['GET'])
def browser_server_status():
    """Get browser server status"""
    try:
        if framework and hasattr(framework, 'browser_server') and framework.browser_server:
            bs = framework.browser_server
            host = bs.host if bs.host != '0.0.0.0' else 'localhost'
            return jsonify({
                'running': bs.is_running(),
                'host': bs.host,
                'port': bs.port,
                'uptime': bs.get_uptime() if hasattr(bs, 'get_uptime') else 0,
                'total_sessions': len(bs.sessions),
                'stats': bs.stats,
                'links': {
                    'inject': f'http://{host}:{bs.port}/inject.js',
                    'xss': f'http://{host}:{bs.port}/xss.js',
                    'admin': f'http://{host}:{bs.port}/admin',
                    'test': f'http://{host}:{bs.port}/test'
                }
            })
        else:
            return jsonify({
                'running': False,
                'host': '0.0.0.0',
                'port': 8080,
                'uptime': 0,
                'total_sessions': 0,
                'stats': {},
                'links': {}
            })
    except Exception as e:
        print_error(f"Error getting browser server status: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/browser_server/start', methods=['POST'])
def browser_server_start():
    """Start browser server"""
    try:
        data = request.json or {}
        host = data.get('host', '0.0.0.0')
        port = data.get('port', 8080)
        timeout = data.get('timeout', 30)
        
        if framework:
            # Stop existing server if running
            if hasattr(framework, 'browser_server') and framework.browser_server and framework.browser_server.is_running():
                framework.browser_server.stop()
                # Kill existing job if any
                from core.job_manager import global_job_manager
                jobs = global_job_manager.get_all_jobs()
                for job_id, job in jobs.items():
                    if job.get('name') == 'Browser Server' and job.get('status') == 'running':
                        global_job_manager.kill_job(job_id)
            
            # Import and start the browser server
            from core.browser_server import BrowserServer
            from core.job_manager import global_job_manager
            import threading
            import time
            
            framework.browser_server = BrowserServer(
                host=host,
                port=port,
                timeout=timeout,
                framework=framework
            )
            
            # Create a job for the browser server
            job_id = global_job_manager.add_job(
                name='Browser Server',
                description=f'Browser exploitation server running on {host}:{port}',
                target=f'{host}:{port}',
                module=framework.browser_server
            )
            
            # Start server in a separate thread
            server_thread = threading.Thread(
                target=framework.browser_server.start,
                daemon=True
            )
            server_thread.start()
            
            # Wait a moment to ensure server started
            time.sleep(1)
            
            if framework.browser_server.is_running():
                add_activity('browser_server_started', f"Browser server started on {host}:{port}", 'System')
                return jsonify({'success': True, 'host': host, 'port': port, 'job_id': job_id})
            else:
                # Update job status if failed
                if job_id:
                    global_job_manager.update_job_status(job_id, 'killed', error='Failed to start server')
                return jsonify({'error': 'Failed to start browser server'}), 500
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error starting browser server: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/browser_server/stop', methods=['POST'])
def browser_server_stop():
    """Stop browser server"""
    try:
        if framework and hasattr(framework, 'browser_server') and framework.browser_server:
            framework.browser_server.stop()
            
            # Kill the associated job
            from core.job_manager import global_job_manager
            jobs = global_job_manager.get_all_jobs()
            for job_id, job in jobs.items():
                if job.get('name') == 'Browser Server' and job.get('status') == 'running':
                    global_job_manager.kill_job(job_id)
                    break
            
            add_activity('browser_server_stopped', "Browser server stopped", 'System')
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Browser server not running'}), 404
    except Exception as e:
        print_error(f"Error stopping browser server: {e}")
        return jsonify({'error': str(e)}), 500

# Jobs API
@app.route('/api/jobs', methods=['GET'])
def list_jobs():
    """List all jobs"""
    try:
        from core.job_manager import global_job_manager
        jobs = global_job_manager.get_all_jobs()
        
        jobs_list = []
        for job_id, job in jobs.items():
            jobs_list.append({
                'id': job_id,
                'name': job.get('name', 'Unknown'),
                'description': job.get('description', ''),
                'status': job.get('status', 'unknown'),
                'target': job.get('target'),
                'started_at': job.get('started_at').isoformat() if job.get('started_at') else None,
                'completed_at': job.get('completed_at').isoformat() if job.get('completed_at') else None,
                'killed_at': job.get('killed_at').isoformat() if job.get('killed_at') else None,
                'output': job.get('output', ''),
                'error': job.get('error', ''),
                'pid': job.get('pid')
            })
        
        return jsonify({'jobs': jobs_list})
    except Exception as e:
        print_error(f"Error listing jobs: {e}")
        return jsonify({'jobs': [], 'error': str(e)}), 500

@app.route('/api/jobs/<int:job_id>', methods=['GET'])
def get_job_details(job_id):
    """Get job details"""
    try:
        from core.job_manager import global_job_manager
        job = global_job_manager.get_job(job_id)
        
        if job:
            return jsonify({
                'id': job_id,
                'name': job.get('name', 'Unknown'),
                'description': job.get('description', ''),
                'status': job.get('status', 'unknown'),
                'target': job.get('target'),
                'started_at': job.get('started_at').isoformat() if job.get('started_at') else None,
                'completed_at': job.get('completed_at').isoformat() if job.get('completed_at') else None,
                'killed_at': job.get('killed_at').isoformat() if job.get('killed_at') else None,
                'output': job.get('output', ''),
                'error': job.get('error', ''),
                'pid': job.get('pid')
            })
        else:
            return jsonify({'error': 'Job not found'}), 404
    except Exception as e:
        print_error(f"Error getting job details: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/jobs/<int:job_id>/kill', methods=['POST'])
def kill_job(job_id):
    """Kill a job"""
    try:
        from core.job_manager import global_job_manager

        # Special handling: if the killed job is the Web Delivery server, we must
        # actually stop the underlying HTTP server thread as well. Otherwise the
        # UI will keep reporting "Running" via /api/web-delivery/status.
        global web_delivery_server, web_delivery_running, web_delivery_job_id
        if web_delivery_job_id == job_id:
            try:
                if web_delivery_running and web_delivery_server:
                    try:
                        web_delivery_server.shutdown()
                        web_delivery_server.server_close()
                    except Exception as stop_err:
                        print_error(f"Error stopping Web Delivery server via job kill: {stop_err}")

                web_delivery_running = False
                web_delivery_job_id = None

                # Mark the job as killed (even if the server was already stopped)
                global_job_manager.update_job_status(job_id, 'killed', output='Web delivery server killed')
                add_activity('job_killed', f"Killed job {job_id}", 'System')
                return jsonify({'success': True})
            except Exception as e:
                print_error(f"Error handling Web Delivery job kill: {e}")
                return jsonify({'error': str(e)}), 500

        success = global_job_manager.kill_job(job_id)
        
        if success:
            add_activity('job_killed', f"Killed job {job_id}", 'System')
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Job not found or already stopped'}), 404
    except Exception as e:
        print_error(f"Error killing job: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/jobs/clear', methods=['POST'])
def clear_jobs():
    """Clear completed jobs"""
    try:
        from core.job_manager import global_job_manager
        count = global_job_manager.clear_completed_jobs()
        return jsonify({'success': True, 'cleared': count})
    except Exception as e:
        print_error(f"Error clearing jobs: {e}")
        return jsonify({'error': str(e)}), 500

# Listener Management
# IMPORTANT: Static routes must be defined BEFORE dynamic routes with parameters
@app.route('/api/listeners/types')
def api_listener_types():
    """Get all available listener module types from the framework"""
    try:
        if not framework:
            return jsonify({'listeners': []})
        
        # Get all listener modules from the framework
        listener_modules = framework.module_loader.get_modules_by_type("listener")
        
        listeners_info = []
        for module_path, module_instance in listener_modules.items():
            try:
                info = getattr(module_instance, '__info__', {})
                name = info.get('name', module_path.split('/')[-1])
                description = info.get('description', 'No description available')
                handler = info.get('handler', 'unknown')
                session_type = info.get('session_type', 'unknown')
                
                # Extract readable type from path
                path_parts = module_path.split('/')
                category = path_parts[1] if len(path_parts) > 1 else 'multi'
                
                listeners_info.append({
                    'path': module_path,
                    'name': name,
                    'description': description,
                    'handler': str(handler),
                    'session_type': str(session_type),
                    'category': category,
                    'display_name': name or module_path.split('/')[-1].replace('_', ' ').title()
                })
            except Exception as e:
                print_error(f"Error getting info for listener {module_path}: {e}")
                continue
        
        # Sort by category and name
        listeners_info.sort(key=lambda x: (x['category'], x['display_name']))
        
        return jsonify({'listeners': listeners_info})
    except Exception as e:
        print_error(f"Error listing listener types: {e}")
        return jsonify({'listeners': [], 'error': str(e)})

@app.route('/api/listeners/create', methods=['POST'])
def create_listener():
    """Create and start a new listener"""
    try:
        if not framework:
            return jsonify({'success': False, 'error': 'Framework not initialized'})
        
        data = request.json
        module_path = data.get('module_path')  # Use module_path instead of type
        port = data.get('port')
        host = data.get('host', '0.0.0.0')
        
        if not module_path or not port:
            return jsonify({'success': False, 'error': 'Module path and port are required'})
        
        # Verify that the module path exists in available listeners
        listener_modules = framework.module_loader.get_modules_by_type("listener")
        if module_path not in listener_modules:
            return jsonify({'success': False, 'error': f'Listener module not found: {module_path}'})
        
        # Load the listener module
        try:
            listener_instance = framework.module_loader.load_module(module_path, framework=framework)
        except Exception as e:
            return jsonify({'success': False, 'error': f'Failed to load listener module: {str(e)}'})
        
        # Configure listener options
        if hasattr(listener_instance, 'lhost'):
            listener_instance.lhost = host
        if hasattr(listener_instance, 'lport'):
            listener_instance.lport = int(port)
        if hasattr(listener_instance, 'rhost'):
            listener_instance.rhost = host
        if hasattr(listener_instance, 'rport'):
            listener_instance.rport = int(port)
        
        # Start the listener
        try:
            if hasattr(listener_instance, 'start'):
                success = listener_instance.start()
                if not success:
                    return jsonify({'success': False, 'error': 'Failed to start listener'})
            else:
                # Fallback: try to run in background
                import threading
                def run_listener():
                    try:
                        listener_instance.run()
                    except Exception as e:
                        print_error(f"Listener error: {e}")
                
                thread = threading.Thread(target=run_listener, daemon=True)
                thread.start()
                listener_instance.running = True
        except Exception as e:
            return jsonify({'success': False, 'error': f'Failed to start listener: {str(e)}'})
        
        # Register listener in framework
        listener_id = getattr(listener_instance, 'listener_id', str(listener_instance))
        framework.active_listeners[listener_id] = listener_instance
        
        # Get listener name for success message
        listener_info = getattr(listener_instance, '__info__', {})
        listener_name = listener_info.get('name', module_path.split('/')[-1])
        
        return jsonify({
            'success': True,
            'listener_id': listener_id,
            'message': f'{listener_name} listener created and started on {host}:{port}'
        })
    except Exception as e:
        print_error(f"Error creating listener: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/listeners')
def api_listeners():
    """Get all active listeners"""
    try:
        if not framework:
            return jsonify({'listeners': []})
        
        listeners = []
        for listener_id, listener_instance in framework.active_listeners.items():
            try:
                # Get listener info - try __info__ first, then name attribute
                listener_info = getattr(listener_instance, '__info__', {})
                listener_type = listener_info.get('name', getattr(listener_instance, 'name', 'Unknown'))
                port = getattr(listener_instance, 'lport', None) or getattr(listener_instance, 'rport', None) or 0
                host = getattr(listener_instance, 'lhost', None) or getattr(listener_instance, 'rhost', None) or '0.0.0.0'
                running = getattr(listener_instance, 'running', False)
                
                listeners.append({
                    'id': listener_id,
                    'type': listener_type,
                    'port': port,
                    'host': host,
                    'status': 'running' if running else 'stopped',
                    'start_time': getattr(listener_instance, 'start_time', None),
                    'stats': getattr(listener_instance, 'stats', {})
                })
            except Exception as e:
                print_error(f"Error getting listener info for {listener_id}: {e}")
                continue
        
        return jsonify({'listeners': listeners})
    except Exception as e:
        print_error(f"Error listing listeners: {e}")
        return jsonify({'listeners': [], 'error': str(e)})

@app.route('/api/listeners/<lid>/start', methods=['POST'])
def start_listener(lid):
    """Start a stopped listener"""
    try:
        if not framework:
            return jsonify({'success': False, 'error': 'Framework not initialized'})
        
        if lid not in framework.active_listeners:
            return jsonify({'success': False, 'error': 'Listener not found'})
        
        listener = framework.active_listeners[lid]
        
        if hasattr(listener, 'start'):
            success = listener.start()
            if success:
                return jsonify({'success': True, 'message': f'Listener {lid} started'})
            else:
                return jsonify({'success': False, 'error': 'Failed to start listener'})
        else:
            return jsonify({'success': False, 'error': 'Listener does not support start method'})
    except Exception as e:
        print_error(f"Error starting listener {lid}: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/listeners/<lid>/stop', methods=['POST'])
def stop_listener(lid):
    """Stop a running listener"""
    try:
        if not framework:
            return jsonify({'success': False, 'error': 'Framework not initialized'})
        
        if lid not in framework.active_listeners:
            return jsonify({'success': False, 'error': 'Listener not found'})
        
        listener = framework.active_listeners[lid]
        
        if hasattr(listener, 'stop'):
            success = listener.stop()
            if success:
                return jsonify({'success': True, 'message': f'Listener {lid} stopped'})
            else:
                return jsonify({'success': False, 'error': 'Failed to stop listener'})
        else:
            # Just mark as stopped
            listener.running = False
            return jsonify({'success': True, 'message': f'Listener {lid} stopped'})
    except Exception as e:
        print_error(f"Error stopping listener {lid}: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/listeners/<lid>', methods=['DELETE'])
def delete_listener(lid):
    """Delete a listener"""
    try:
        if not framework:
            return jsonify({'success': False, 'error': 'Framework not initialized'})
        
        if lid not in framework.active_listeners:
            return jsonify({'success': False, 'error': 'Listener not found'})
        
        listener = framework.active_listeners[lid]

        # Safety rule: only allow delete when stopped
        running = bool(getattr(listener, 'running', False))
        if running:
            return jsonify({
                'success': False,
                'error': 'Listener is running. Stop it before deleting.'
            }), 409
        
        # Remove from active listeners
        del framework.active_listeners[lid]
        
        return jsonify({'success': True, 'message': f'Listener {lid} deleted'})
    except Exception as e:
        print_error(f"Error deleting listener {lid}: {e}")
        return jsonify({'success': False, 'error': str(e)})

# Module Execution
@app.route('/api/modules')
def api_modules():
    # List post-exploitation modules
    modules = [
        {'id': 'enum_host', 'name': 'enumerate/host', 'description': 'Gather OS info, users, patches', 'category': 'enumeration'},
        {'id': 'dump_hashes', 'name': 'creds/dump_hashes', 'description': 'Dump SAM/LSA secrets', 'category': 'credentials'},
        {'id': 'getsystem', 'name': 'privesc/getsystem', 'description': 'Attempt privilege escalation', 'category': 'privesc'},
        {'id': 'enum_network', 'name': 'enumerate/network', 'description': 'Discover network hosts and services', 'category': 'enumeration'},
    ]
    return jsonify({'modules': modules})

@app.route('/api/modules/list', methods=['GET'])
def list_modules():
    """List all available modules as a tree structure"""
    try:
        if framework and hasattr(framework, 'module_loader'):
            discovered = framework.module_loader.discover_modules()
            modules = []
            for module_path, file_path in discovered.items():
                # Extract type from path
                parts = module_path.split('/')
                module_type = parts[0] if len(parts) > 0 else 'other'
                module_name = parts[-1] if len(parts) > 0 else module_path
                
                # Just add basic info without loading the module
                modules.append({
                    'path': module_path,
                    'type': module_type,
                    'name': module_name,
                    'file_path': file_path
                })
            
            # Build tree structure
            tree = {}
            for module in modules:
                parts = module['path'].split('/')
                current = tree
                for i, part in enumerate(parts):
                    is_last = i == len(parts) - 1
                    if part not in current:
                        current[part] = {
                            'name': part,
                            'path': '/'.join(parts[:i+1]),
                            'is_file': is_last,
                            'children': {} if not is_last else None,
                            'expanded': False  # Folders are collapsed by default
                        }
                    if not is_last:
                        if current[part].get('children') is None:
                            current[part]['children'] = {}
                        current = current[part]['children']
            
            return jsonify({'modules': modules, 'tree': tree})
        else:
            # Fallback: return empty list
            return jsonify({'modules': [], 'tree': {}})
    except Exception as e:
        print_error(f"Error listing modules: {e}")
        return jsonify({'modules': [], 'tree': {}, 'error': str(e)}), 500

@app.route('/api/modules/<path:module_path>', methods=['GET'])
def get_module(module_path):
    """Get module content"""
    try:
        if framework and hasattr(framework, 'module_loader'):
            discovered = framework.module_loader.discover_modules()
            if module_path in discovered:
                file_path = discovered[module_path]
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                return jsonify({'content': content, 'path': module_path})
            else:
                return jsonify({'error': 'Module not found'}), 404
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error getting module {module_path}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/modules/<path:module_path>/load', methods=['GET'])
def load_module_info(module_path):
    """Load a module and get its information (description, author, options)"""
    try:
        # Decode URL-encoded path
        import urllib.parse
        module_path = urllib.parse.unquote(module_path)
        
        # Ensure framework is initialized
        global framework
        if not framework or not framework_initialized:
            print_info("Framework not initialized, initializing now...")
            try:
                init_framework()
            except Exception as init_err:
                import traceback
                traceback.print_exc()
                print_error(f"Failed to initialize framework: {init_err}")
                return jsonify({'error': f'Framework initialization failed: {str(init_err)}'}), 500
        
        if not framework:
            return jsonify({'error': 'Framework not initialized'}), 500
            
        if not hasattr(framework, 'module_loader'):
            return jsonify({'error': 'Module loader not available'}), 500
        
        # First, check if module exists in discovered modules
        try:
            discovered = framework.module_loader.discover_modules()
        except Exception as discover_err:
            print_error(f"Error discovering modules: {discover_err}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': f'Error discovering modules: {str(discover_err)}'}), 500
        
        if not discovered:
            return jsonify({'error': 'No modules discovered. Check module_loader configuration.'}), 500
        
        # Debug: log the module path and some discovered paths
        print_info(f"Attempting to load module: {module_path}")
        print_info(f"Total discovered modules: {len(discovered)}")
        
        # Check if module exists (exact match)
        if module_path not in discovered:
            # Try to find similar paths (case-insensitive)
            module_path_lower = module_path.lower()
            matching_paths = [path for path in discovered.keys() if path.lower() == module_path_lower]
            if matching_paths:
                module_path = matching_paths[0]
                print_info(f"Using case-insensitive match: {module_path}")
            else:
                # Check if it's a path issue (maybe missing 'modules/' prefix)
                if not module_path.startswith('modules/'):
                    alt_path = f'modules/{module_path}'
                    if alt_path in discovered:
                        module_path = alt_path
                        print_info(f"Using path with 'modules/' prefix: {module_path}")
                    else:
                        # Return available modules for debugging
                        available_modules = [p for p in discovered.keys() if 'auxiliary/scanner/http' in p][:10]
                        print_error(f"Module not found. Searched: {module_path}, alt: {alt_path}")
                        print_error(f"Sample paths: {list(discovered.keys())[:5]}")
                        return jsonify({
                            'error': f'Module not found: {module_path}',
                            'hint': 'Try checking the module path format',
                            'available_modules_sample': available_modules,
                            'total_modules': len(discovered),
                            'searched_path': module_path,
                            'discovered_sample': list(discovered.keys())[:5]
                        }), 404
                else:
                    # Return available modules for debugging
                    available_modules = [p for p in discovered.keys() if 'auxiliary/scanner/http' in p][:10]
                    print_error(f"Module not found. Searched: {module_path}")
                    print_error(f"Sample paths: {list(discovered.keys())[:5]}")
                    return jsonify({
                        'error': f'Module not found: {module_path}',
                        'hint': 'Try checking the module path format',
                        'available_modules_sample': available_modules,
                        'total_modules': len(discovered),
                        'searched_path': module_path,
                        'discovered_sample': list(discovered.keys())[:5]
                    }), 404
        
        # Load the module - use framework.load_module which handles everything
        try:
            print_info(f"Loading module via framework.load_module: {module_path}")
            module_instance = framework.load_module(module_path)
            print_info(f"Module loaded: {module_instance is not None}")
        except Exception as load_err:
            import traceback
            error_trace = traceback.format_exc()
            print_error(f"Error loading module {module_path}: {load_err}")
            print_error(f"Traceback: {error_trace}")
            return jsonify({
                'error': f'Could not load module: {str(load_err)}',
                'module_path': module_path,
                'traceback': error_trace if app.debug else None
            }), 404
        
        if not module_instance:
            # Try loading directly via module_loader as fallback
            try:
                print_info(f"Trying direct module_loader.load_module: {module_path}")
                module_instance = framework.module_loader.load_module(module_path, framework=framework)
                print_info(f"Direct load result: {module_instance is not None}")
            except Exception as direct_err:
                print_error(f"Direct load also failed: {direct_err}")
        
        if not module_instance:
            file_path = discovered.get(module_path, '')
            file_exists = os.path.exists(file_path) if file_path else False
            return jsonify({
                'error': 'Module not found or could not be loaded',
                'module_path': module_path,
                'file_path': file_path,
                'file_exists': file_exists
            }), 404

        # Get module information
        info = {}
        if hasattr(module_instance, '__info__') and module_instance.__info__:
            info = module_instance.__info__
        
        # Get module options from exploit_attributes / descriptors
        options = []
        raw_options = {}
        try:
            raw_options = module_instance.get_options()
        except Exception as opt_err:
            print_error(f"Error retrieving module options for {module_path}: {opt_err}")
            raw_options = getattr(module_instance, 'exploit_attributes', {}) or {}
        
        if isinstance(raw_options, dict):
            for opt_name, opt_data in raw_options.items():
                try:
                    default_value = ''
                    required = False
                    description = ''
                    advanced = False
                    
                    if isinstance(opt_data, (list, tuple)):
                        default_value = opt_data[0] if len(opt_data) > 0 else ''
                        required = bool(opt_data[1]) if len(opt_data) > 1 else False
                        description = opt_data[2] if len(opt_data) > 2 else ''
                        advanced = bool(opt_data[3]) if len(opt_data) > 3 else False
                    elif isinstance(opt_data, dict):
                        default_value = opt_data.get('value') or opt_data.get('default', '')
                        required = bool(opt_data.get('required', False))
                        description = opt_data.get('description', '')
                        advanced = bool(opt_data.get('advanced', False))
                    elif opt_data is not None:
                        default_value = str(opt_data)
                    
                    # Try getting the descriptor for more accurate data
                    current_value = default_value
                    descriptor = getattr(type(module_instance), opt_name, None)
                    if descriptor and hasattr(descriptor, 'to_dict'):
                        descriptor_dict = descriptor.to_dict(module_instance)
                        default_value = descriptor_dict.get('display_value', default_value)
                        current_value = descriptor_dict.get('value', default_value)
                        required = descriptor_dict.get('required', required)
                        description = descriptor_dict.get('description', description)
                        advanced = descriptor_dict.get('advanced', advanced)
                    else:
                        try:
                            descriptor_value = getattr(module_instance, opt_name)
                            current_value = descriptor_value if descriptor_value not in (None, '') else default_value
                        except Exception:
                            current_value = default_value
                    
                    # Detect option type
                    opt_type = 'string'  # default
                    if descriptor:
                        # Try to get type from descriptor
                        if hasattr(descriptor, 'type'):
                            opt_type = str(descriptor.type).lower()
                        elif hasattr(descriptor, '__class__'):
                            class_name = descriptor.__class__.__name__.lower()
                            if 'bool' in class_name:
                                opt_type = 'bool'
                            elif 'int' in class_name or 'integer' in class_name:
                                opt_type = 'int'
                            elif 'port' in class_name:
                                opt_type = 'port'
                            elif 'string' in class_name:
                                opt_type = 'string'
                    
                    # Also check by value or name
                    if isinstance(current_value, bool) or str(current_value).lower() in ('true', 'false'):
                        opt_type = 'bool'
                    elif opt_name.lower() in ('session_id', 'sessionid', 'sid'):
                        opt_type = 'session_id'
                    
                    options.append({
                        'name': opt_name,
                        'type': opt_type,
                        'required': bool(required),
                        'description': description or '',
                        'advanced': bool(advanced),
                        'current_value': str(current_value) if current_value is not None else ''
                    })
                except Exception as opt_err:
                    print_error(f"Error processing option {opt_name}: {opt_err}")
                    continue
        
        # Sort options: required first, then by name
        options.sort(key=lambda x: (not x['required'], x['name']))
        
        return jsonify({
            'path': module_path,
            'name': info.get('name', module_path.split('/')[-1]),
            'description': info.get('description', ''),
            'author': info.get('author', 'Unknown'),
            'options': options
        })
    except Exception as e:
        print_error(f"Error loading module {module_path}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/modules/<path:module_path>', methods=['PUT'])
def save_module(module_path):
    """Save module content"""
    try:
        if framework and hasattr(framework, 'module_loader'):
            discovered = framework.module_loader.discover_modules()
            if module_path in discovered:
                file_path = discovered[module_path]
                data = request.json
                content = data.get('content', '')
                
                # Backup original file
                import shutil
                backup_path = file_path + '.bak'
                shutil.copy2(file_path, backup_path)
                
                # Write new content
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                
                add_activity('module_edited', f"Module '{module_path}' edited", 'System')
                return jsonify({'success': True, 'path': module_path})
            else:
                return jsonify({'error': 'Module not found'}), 404
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error saving module {module_path}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/modules/create', methods=['POST'])
def create_module():
    """Create a new module"""
    try:
        data = request.json
        module_path = data.get('path')
        content = data.get('content', '')
        
        if not module_path:
            return jsonify({'error': 'Module path is required'}), 400
        
        # Determine file path
        if framework and hasattr(framework, 'module_loader'):
            modules_path = framework.module_loader.modules_path
        else:
            modules_path = 'modules'
        
        # Convert module path to file path
        file_path = os.path.join(modules_path, module_path.replace('/', os.sep) + '.py')
        
        # Create directory if needed
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        # Write file
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        add_activity('module_created', f"Module '{module_path}' created", 'System')
        return jsonify({'success': True, 'path': module_path})
    except Exception as e:
        print_error(f"Error creating module: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/session/<sid>/run_module', methods=['POST'])
def run_module(sid):
    """Execute a module on a session"""
    try:
        if not framework:
            return jsonify({'success': False, 'error': 'Framework not initialized'}), 500
        
        data = request.get_json(silent=True) or {}
        module_path = data.get('module_id') or data.get('module_path')
        options = data.get('options', {})
        
        if not module_path:
            return jsonify({'success': False, 'error': 'Module path is required'}), 400
        
        # Get session to determine type
        session = None
        is_browser_session = False
        if framework and hasattr(framework, 'session_manager'):
            sm = framework.session_manager
            # Try standard session first
            session = sm.get_session(sid)
            if not session:
                # Try browser session
                browser_session = sm.get_browser_session(sid)
                if browser_session:
                    is_browser_session = True
        
        # Load the module
        try:
            module_instance = framework.load_module(module_path)
            if not module_instance:
                return jsonify({'success': False, 'error': f'Failed to load module: {module_path}'}), 404
        except Exception as load_err:
            import traceback
            return jsonify({
                'success': False,
                'error': f'Error loading module: {str(load_err)}',
                'traceback': traceback.format_exc() if app.debug else None
            }), 500
        
        # Set module options
        for opt_name, opt_value in options.items():
            if hasattr(module_instance, opt_name):
                opt_attr = getattr(module_instance, opt_name)
                # Handle OptString/OptInteger/OptBool descriptors
                if hasattr(opt_attr, 'value'):
                    opt_attr.value = opt_value
                else:
                    setattr(module_instance, opt_name, opt_value)
        
        # For browser modules, ensure session_id is set and browser_server is available
        if is_browser_session or 'browser' in module_path.lower():
            # Set session_id if not already in options (override with provided value if any)
            final_session_id = options.get('session_id') or sid
            if hasattr(module_instance, 'session_id'):
                if hasattr(module_instance.session_id, 'value'):
                    module_instance.session_id.value = final_session_id
                else:
                    module_instance.session_id = final_session_id
                # Also update options dict for consistency
                options['session_id'] = final_session_id
            
            # Ensure browser_server is set on the module
            if hasattr(framework, 'browser_server') and framework.browser_server:
                if hasattr(module_instance, 'browser_server'):
                    module_instance.browser_server = framework.browser_server
                elif hasattr(module_instance, '_ensure_browser_server'):
                    module_instance._ensure_browser_server()
            else:
                # Browser server not available - warn but don't fail (module might handle it)
                print_warning(f"Browser server not available. Module {module_path} may not work correctly.")
        
        # For post modules, set session if available
        elif session and 'post' in module_path.lower():
            # Post modules might need session_id or SID option
            if hasattr(module_instance, 'session_id'):
                if hasattr(module_instance.session_id, 'value'):
                    module_instance.session_id.value = sid
                else:
                    module_instance.session_id = sid
            elif hasattr(module_instance, 'SID'):
                if hasattr(module_instance.SID, 'value'):
                    module_instance.SID.value = sid
                else:
                    module_instance.SID = sid
        
        # Set framework reference and current module
        module_instance.framework = framework
        framework.current_module = module_instance
        
        # Generate execution ID for real-time streaming
        import uuid
        execution_id = str(uuid.uuid4())
        
        # Initialize output storage
        with module_outputs_lock:
            module_outputs[execution_id] = "Module execution started...\n"
        
        # Execute the module in background thread with real-time output capture
        def run_with_capture():
            try:
                import io
                import sys
                from contextlib import redirect_stdout, redirect_stderr
                
                # Create a custom StringIO that updates module_outputs in real-time
                class RealtimeStringIO(io.StringIO):
                    def __init__(self, execution_id):
                        super().__init__()
                        self.execution_id = execution_id
                        self._buffer = []
                    
                    def write(self, s):
                        if s:
                            super().write(s)
                            self._buffer.append(s)
                            # Update output in real-time
                            with module_outputs_lock:
                                current = module_outputs.get(self.execution_id, "")
                                module_outputs[self.execution_id] = current + s
                        return len(s)
                    
                    def flush(self):
                        # Force update
                        with module_outputs_lock:
                            current = module_outputs.get(self.execution_id, "")
                            full_output = ''.join(self._buffer)
                            if full_output != current:
                                module_outputs[self.execution_id] = full_output
                        super().flush()
                
                output_buffer = RealtimeStringIO(execution_id)
                error_buffer = RealtimeStringIO(execution_id)
                
                # Patch print functions for real-time output
                original_print = print
                def patched_print(*args, **kwargs):
                    message = ' '.join(str(arg) for arg in args)
                    output_buffer.write(message + '\n')
                    output_buffer.flush()
                    original_print(*args, **kwargs)
                
                # Patch core.output_handler and kittysploit functions for real-time output
                original_funcs = {}
                output_handler_module = None
                patches_applied = {}  # Track patches for restoration
                
                def make_patched_func(func_name, orig_func, prefix):
                    """Create a patched function that writes to buffer"""
                    def patched(*args, **kwargs):
                        message = ' '.join(str(arg) for arg in args) if args else ""
                        formatted = f"{prefix}{message}\n" if prefix else f"{message}\n"
                        output_buffer.write(formatted)
                        output_buffer.flush()
                        return orig_func(*args, **kwargs)
                    return patched
                
                # Patch core.output_handler
                try:
                    import core.output_handler as output_handler_module
                    prefix_map = {
                        'print_info': '',
                        'print_status': '[*] ',
                        'print_success': '[+] ',
                        'print_error': '[!] ',
                        'print_warning': '[~] '
                    }
                    for func_name in ['print_info', 'print_status', 'print_success', 'print_error', 'print_warning']:
                        if hasattr(output_handler_module, func_name):
                            original_func = getattr(output_handler_module, func_name)
                            if func_name not in original_funcs:
                                original_funcs[func_name] = original_func
                            prefix = prefix_map.get(func_name, '')
                            patched = make_patched_func(func_name, original_func, prefix)
                            setattr(output_handler_module, func_name, patched)
                            patches_applied[f'core.output_handler.{func_name}'] = (output_handler_module, func_name, original_func)
                except Exception as e:
                    output_buffer.write(f"Warning: Could not patch core.output_handler: {e}\n")
                
                # Patch kittysploit module (where modules import from)
                try:
                    if 'kittysploit' in sys.modules:
                        kittysploit_module = sys.modules['kittysploit']
                        prefix_map = {
                            'print_info': '',
                            'print_status': '[*] ',
                            'print_success': '[+] ',
                            'print_error': '[!] ',
                            'print_warning': '[~] '
                        }
                        for func_name in ['print_info', 'print_status', 'print_success', 'print_error', 'print_warning']:
                            if hasattr(kittysploit_module, func_name):
                                if func_name not in original_funcs:
                                    original_funcs[func_name] = getattr(kittysploit_module, func_name)
                                prefix = prefix_map.get(func_name, '')
                                patched = make_patched_func(func_name, original_funcs[func_name], prefix)
                                setattr(kittysploit_module, func_name, patched)
                                patches_applied[f'kittysploit.{func_name}'] = (kittysploit_module, func_name, original_funcs[func_name])
                except Exception as e:
                    output_buffer.write(f"Warning: Could not patch kittysploit module: {e}\n")
                
                with redirect_stdout(output_buffer), redirect_stderr(error_buffer):
                    try:
                        # Use runtime kernel for better execution context
                        result = framework.execute_module(use_runtime_kernel=True)
                        output = output_buffer.getvalue()
                        errors = error_buffer.getvalue()
                        
                        # Combine output and errors
                        full_output = output
                        if errors:
                            full_output += f"\n[Errors]\n{errors}"
                        
                        # Mark as completed
                        with module_outputs_lock:
                            module_outputs[execution_id] = full_output + "\n[MODULE_COMPLETED]"
                        
                        # Restore original functions
                        try:
                            for module_path_key, (module_obj, func_name, original_func) in patches_applied.items():
                                try:
                                    setattr(module_obj, func_name, original_func)
                                except:
                                    pass
                        except:
                            pass
                        
                        # Add to activity feed
                        add_activity('module_exec', f'Executed {module_path} on session {sid}', sid)
                    except Exception as e:
                        import traceback
                        error_msg = f"{str(e)}\n{traceback.format_exc()}"
                        output = output_buffer.getvalue()
                        errors = error_buffer.getvalue()
                        
                        with module_outputs_lock:
                            module_outputs[execution_id] = output + f"\n[Errors]\n{errors}\n[MODULE_COMPLETED]"
                        
                        # Restore original functions
                        try:
                            for module_path_key, (module_obj, func_name, original_func) in patches_applied.items():
                                try:
                                    setattr(module_obj, func_name, original_func)
                                except:
                                    pass
                        except:
                            pass
            except Exception as e:
                import traceback
                with module_outputs_lock:
                    module_outputs[execution_id] = f"Error executing module: {str(e)}\n{traceback.format_exc()}\n[MODULE_COMPLETED]"
        
        # Start execution in background thread
        execution_thread = threading.Thread(target=run_with_capture, daemon=True)
        execution_thread.start()
        
        # Return execution_id immediately for polling
        return jsonify({
            'success': True,
            'execution_id': execution_id,
            'is_running': True,
            'output': module_outputs.get(execution_id, '')
        })
    except Exception as e:
        import traceback
        print_error(f"Error executing module on session {sid}: {e}")
        return jsonify({
            'success': False,
            'error': f'Error executing module: {str(e)}',
            'traceback': traceback.format_exc() if app.debug else None
        }), 500

# Module Output API for real-time streaming
@app.route('/api/module-output/<execution_id>', methods=['GET'])
def get_module_output(execution_id):
    """Get module output by execution ID for real-time streaming"""
    with module_outputs_lock:
        output_text = module_outputs.get(execution_id, "Module execution not found or completed.")
    
    # Check if module is completed
    is_completed = '[MODULE_COMPLETED]' in output_text
    
    return jsonify({
        'status': 'success',
        'output': output_text,
        'execution_id': execution_id,
        'is_completed': is_completed
    })

@app.route('/api/module-output/<execution_id>', methods=['DELETE'])
def delete_module_output(execution_id):
    """Delete module output by execution ID (cleanup)"""
    with module_outputs_lock:
        if execution_id in module_outputs:
            del module_outputs[execution_id]
            return jsonify({'status': 'success', 'message': 'Output deleted'})
        return jsonify({'status': 'error', 'message': 'Output not found'}), 404

# Activity Feed API
@app.route('/api/activity')
def get_activity():
    return jsonify({'activities': activity_feed[-50:]})  # Last 50 activities

# Guardian API Routes
@app.route('/api/guardian/status', methods=['GET'])
def guardian_status():
    """Get Guardian status"""
    try:
        # Try to get guardian_manager from framework
        gm = None
        if framework:
            # Check if guardian_manager exists, if not create it
            if not hasattr(framework, 'guardian_manager'):
                try:
                    from core.guardian_manager import GuardianManager
                    framework.guardian_manager = GuardianManager()
                except Exception as e:
                    print_error(f"Error initializing guardian_manager: {e}")
            
            if hasattr(framework, 'guardian_manager'):
                gm = framework.guardian_manager
        
        if gm:
            alerts_data = []
            try:
                alerts_data = [asdict(a) for a in gm.alerts[-20:]]
            except:
                # If asdict fails, convert manually
                for alert in gm.alerts[-20:]:
                    alerts_data.append({
                        'timestamp': getattr(alert, 'timestamp', ''),
                        'severity': getattr(alert, 'severity', ''),
                        'target': getattr(alert, 'target', ''),
                        'issue': getattr(alert, 'issue', ''),
                        'confidence': getattr(alert, 'confidence', 0.0),
                        'recommendations': getattr(alert, 'recommendations', []),
                        'auto_action_taken': getattr(alert, 'auto_action_taken', False),
                        'action_description': getattr(alert, 'action_description', ''),
                        'evidence': getattr(alert, 'evidence', [])
                    })
            
            return jsonify({
                'enabled': gm.enabled,
                'verbose': gm.verbose,
                'auto_action': gm.auto_action,
                'stats': gm.stats,
                'blacklist': {k: v for k, v in gm.blacklist.items()},
                'whitelist': list(gm.whitelist),
                'alerts': alerts_data
            })
        else:
            return jsonify({
                'enabled': False,
                'verbose': False,
                'auto_action': False,
                'stats': {},
                'blacklist': {},
                'whitelist': [],
                'alerts': []
            })
    except Exception as e:
        print_error(f"Error getting guardian status: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/guardian/enable', methods=['POST'])
def guardian_enable():
    """Enable Guardian"""
    try:
        data = request.json or {}
        verbose = data.get('verbose', False)
        auto_action = data.get('auto_action', False)
        
        if framework:
            if not hasattr(framework, 'guardian_manager'):
                try:
                    from core.guardian_manager import GuardianManager
                    framework.guardian_manager = GuardianManager()
                except Exception as e:
                    print_error(f"Error initializing guardian_manager: {e}")
                    return jsonify({'error': f'Failed to initialize guardian: {str(e)}'}), 500
            
            if hasattr(framework, 'guardian_manager'):
                framework.guardian_manager.enable(verbose=verbose, auto_action=auto_action)
                return jsonify({'success': True, 'enabled': True})
            else:
                return jsonify({'error': 'Failed to initialize guardian_manager'}), 500
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error enabling guardian: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/guardian/disable', methods=['POST'])
def guardian_disable():
    """Disable Guardian"""
    try:
        if framework and hasattr(framework, 'guardian_manager'):
            framework.guardian_manager.disable()
            return jsonify({'success': True, 'enabled': False})
        else:
            return jsonify({'error': 'Guardian not initialized'}), 500
    except Exception as e:
        print_error(f"Error disabling guardian: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/guardian/blacklist', methods=['GET'])
def guardian_blacklist_get():
    """Get blacklist"""
    try:
        if framework and hasattr(framework, 'guardian_manager'):
            return jsonify({'blacklist': {k: v for k, v in framework.guardian_manager.blacklist.items()}})
        else:
            return jsonify({'blacklist': {}})
    except Exception as e:
        print_error(f"Error getting blacklist: {e}")
        return jsonify({'blacklist': {}, 'error': str(e)}), 500

@app.route('/api/guardian/blacklist/add', methods=['POST'])
def guardian_blacklist_add():
    """Add IP to blacklist"""
    try:
        data = request.json
        ip = data.get('ip')
        reason = data.get('reason', 'Manual addition')
        
        if not ip:
            return jsonify({'error': 'IP address required'}), 400
        
        if framework:
            if not hasattr(framework, 'guardian_manager'):
                try:
                    from core.guardian_manager import GuardianManager
                    framework.guardian_manager = GuardianManager()
                except Exception as e:
                    return jsonify({'error': f'Failed to initialize guardian: {str(e)}'}), 500
            
            if hasattr(framework, 'guardian_manager'):
                framework.guardian_manager.blacklist[ip] = {
                    'reason': reason,
                    'timestamp': datetime.now().isoformat(),
                    'added_by': 'web_ui'
                }
                return jsonify({'success': True, 'ip': ip})
            else:
                return jsonify({'error': 'Guardian not initialized'}), 500
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error adding to blacklist: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/guardian/blacklist/remove', methods=['POST'])
def guardian_blacklist_remove():
    """Remove IP from blacklist"""
    try:
        data = request.json
        ip = data.get('ip')
        
        if not ip:
            return jsonify({'error': 'IP address required'}), 400
        
        if framework and hasattr(framework, 'guardian_manager'):
            if ip in framework.guardian_manager.blacklist:
                del framework.guardian_manager.blacklist[ip]
                return jsonify({'success': True, 'ip': ip})
            else:
                return jsonify({'error': 'IP not in blacklist'}), 404
        else:
            return jsonify({'error': 'Guardian not initialized'}), 500
    except Exception as e:
        print_error(f"Error removing from blacklist: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/guardian/whitelist', methods=['GET'])
def guardian_whitelist_get():
    """Get whitelist"""
    try:
        if framework and hasattr(framework, 'guardian_manager'):
            return jsonify({'whitelist': list(framework.guardian_manager.whitelist)})
        else:
            return jsonify({'whitelist': []})
    except Exception as e:
        print_error(f"Error getting whitelist: {e}")
        return jsonify({'whitelist': [], 'error': str(e)}), 500

@app.route('/api/guardian/whitelist/add', methods=['POST'])
def guardian_whitelist_add():
    """Add IP to whitelist"""
    try:
        data = request.json
        ip = data.get('ip')
        
        if not ip:
            return jsonify({'error': 'IP address required'}), 400
        
        if framework:
            if not hasattr(framework, 'guardian_manager'):
                try:
                    from core.guardian_manager import GuardianManager
                    framework.guardian_manager = GuardianManager()
                except Exception as e:
                    return jsonify({'error': f'Failed to initialize guardian: {str(e)}'}), 500
            
            if hasattr(framework, 'guardian_manager'):
                framework.guardian_manager.whitelist.add(ip)
                return jsonify({'success': True, 'ip': ip})
            else:
                return jsonify({'error': 'Guardian not initialized'}), 500
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error adding to whitelist: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/guardian/whitelist/remove', methods=['POST'])
def guardian_whitelist_remove():
    """Remove IP from whitelist"""
    try:
        data = request.json
        ip = data.get('ip')
        
        if not ip:
            return jsonify({'error': 'IP address required'}), 400
        
        if framework and hasattr(framework, 'guardian_manager'):
            if ip in framework.guardian_manager.whitelist:
                framework.guardian_manager.whitelist.remove(ip)
                return jsonify({'success': True, 'ip': ip})
            else:
                return jsonify({'error': 'IP not in whitelist'}), 404
        else:
            return jsonify({'error': 'Guardian not initialized'}), 500
    except Exception as e:
        print_error(f"Error removing from whitelist: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/guardian/alerts', methods=['GET'])
def guardian_alerts():
    """Get recent alerts"""
    try:
        limit = request.args.get('limit', 50, type=int)
        if framework and hasattr(framework, 'guardian_manager'):
            alerts = framework.guardian_manager.alerts[-limit:]
            alerts_data = []
            try:
                alerts_data = [asdict(a) for a in alerts]
            except:
                for alert in alerts:
                    alerts_data.append({
                        'timestamp': getattr(alert, 'timestamp', ''),
                        'severity': getattr(alert, 'severity', ''),
                        'target': getattr(alert, 'target', ''),
                        'issue': getattr(alert, 'issue', ''),
                        'confidence': getattr(alert, 'confidence', 0.0),
                        'recommendations': getattr(alert, 'recommendations', []),
                        'auto_action_taken': getattr(alert, 'auto_action_taken', False),
                        'action_description': getattr(alert, 'action_description', ''),
                        'evidence': getattr(alert, 'evidence', [])
                    })
            return jsonify({'alerts': alerts_data})
        else:
            return jsonify({'alerts': []})
    except Exception as e:
        print_error(f"Error getting alerts: {e}")
        return jsonify({'alerts': [], 'error': str(e)}), 500

@app.route('/api/output/list', methods=['GET'])
def output_list():
    """List files and directories in the output directory"""
    try:
        output_dir = os.path.join(os.getcwd(), 'output')
        
        # Create output directory if it doesn't exist
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            return jsonify({'files': [], 'directories': []})
        
        files = []
        directories = []
        
        for item in os.listdir(output_dir):
            item_path = os.path.join(output_dir, item)
            rel_path = os.path.relpath(item_path, output_dir)
            
            stat_info = os.stat(item_path)
            
            item_data = {
                'name': item,
                'path': rel_path.replace('\\', '/'),
                'size': stat_info.st_size,
                'modified': datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
                'created': datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
                'is_file': os.path.isfile(item_path),
                'is_dir': os.path.isdir(item_path)
            }
            
            if os.path.isfile(item_path):
                files.append(item_data)
            else:
                directories.append(item_data)
        
        # Sort: directories first, then files, both alphabetically
        directories.sort(key=lambda x: x['name'].lower())
        files.sort(key=lambda x: x['name'].lower())
        
        return jsonify({
            'files': files,
            'directories': directories,
            'path': 'output'
        })
    except Exception as e:
        print_error(f"Error listing output directory: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/output/file/<path:file_path>', methods=['GET'])
def output_file_info(file_path):
    """Get file properties"""
    try:
        output_dir = os.path.join(os.getcwd(), 'output')
        full_path = os.path.join(output_dir, file_path)
        
        # Security: ensure the path is within output directory
        full_path = os.path.abspath(full_path)
        output_dir_abs = os.path.abspath(output_dir)
        
        if not full_path.startswith(output_dir_abs):
            return jsonify({'error': 'Access denied'}), 403
        
        if not os.path.exists(full_path):
            return jsonify({'error': 'File not found'}), 404
        
        stat_info = os.stat(full_path)
        
        file_info = {
            'name': os.path.basename(full_path),
            'path': file_path.replace('\\', '/'),
            'full_path': full_path,
            'size': stat_info.st_size,
            'size_human': _format_size(stat_info.st_size),
            'modified': datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
            'created': datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
            'is_file': os.path.isfile(full_path),
            'is_dir': os.path.isdir(full_path),
            'extension': os.path.splitext(full_path)[1] if os.path.isfile(full_path) else None
        }
        
        # If it's a directory, get its contents count
        if os.path.isdir(full_path):
            try:
                contents = os.listdir(full_path)
                file_info['item_count'] = len(contents)
            except:
                file_info['item_count'] = 0
        
        return jsonify(file_info)
    except Exception as e:
        print_error(f"Error getting file info: {e}")
        return jsonify({'error': str(e)}), 500

def _format_size(size_bytes):
    """Format file size in human readable format"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} PB"

def _parse_python_functions(file_path):
    """Parse Python file and extract functions with their signatures and docstrings"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        tree = ast.parse(content)
        functions = []
        classes = []
        
        # Track methods that belong to classes to avoid double counting
        class_methods = set()
        
        # First pass: extract classes and their methods
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                class_info = {
                    'name': node.name,
                    'type': 'class',
                    'docstring': ast.get_docstring(node) or '',
                    'line': node.lineno,
                    'methods': []
                }
                
                # Extract methods from class
                for item in node.body:
                    if isinstance(item, ast.FunctionDef):
                        class_methods.add((node.name, item.name))
                        method_info = {
                            'name': item.name,
                            'type': 'method',
                            'signature': _get_function_signature(item),
                            'docstring': ast.get_docstring(item) or '',
                            'line': item.lineno,
                            'inputs': _extract_inputs_from_docstring(ast.get_docstring(item) or ''),
                            'outputs': _extract_outputs_from_docstring(ast.get_docstring(item) or ''),
                            'args': _get_function_args(item)
                        }
                        class_info['methods'].append(method_info)
                
                classes.append(class_info)
        
        # Second pass: extract standalone functions (not in classes)
        for node in tree.body:
            if isinstance(node, ast.FunctionDef):
                # Check if this function is not a method
                is_method = False
                for class_name, method_name in class_methods:
                    if method_name == node.name:
                        is_method = True
                        break
                
                if not is_method:
                    func_info = {
                        'name': node.name,
                        'type': 'function',
                        'signature': _get_function_signature(node),
                        'docstring': ast.get_docstring(node) or '',
                        'line': node.lineno,
                        'inputs': _extract_inputs_from_docstring(ast.get_docstring(node) or ''),
                        'outputs': _extract_outputs_from_docstring(ast.get_docstring(node) or ''),
                        'args': _get_function_args(node)
                    }
                    functions.append(func_info)
        
        return {
            'functions': functions,
            'classes': classes,
            'module_docstring': ast.get_docstring(tree) or ''
        }
    except Exception as e:
        print_error(f"Error parsing Python file: {e}")
        import traceback
        traceback.print_exc()
        return {'functions': [], 'classes': [], 'module_docstring': '', 'error': str(e)}

def _get_function_signature(node):
    """Extract function signature as string"""
    args = []
    for arg in node.args.args:
        arg_str = arg.arg
        if arg.annotation:
            # Try to get annotation as string
            try:
                if hasattr(ast, 'unparse'):
                    arg_str += ': ' + ast.unparse(arg.annotation)
                elif isinstance(arg.annotation, ast.Name):
                    arg_str += ': ' + arg.annotation.id
                elif isinstance(arg.annotation, ast.Constant):
                    arg_str += ': ' + str(arg.annotation.value)
            except:
                pass
        args.append(arg_str)
    
    signature = f"{node.name}({', '.join(args)})"
    
    if node.returns:
        try:
            if hasattr(ast, 'unparse'):
                signature += ' -> ' + ast.unparse(node.returns)
            elif isinstance(node.returns, ast.Name):
                signature += ' -> ' + node.returns.id
        except:
            pass
    
    return signature

def _get_function_args(node):
    """Extract function arguments with their types"""
    args_list = []
    for arg in node.args.args:
        arg_info = {
            'name': arg.arg,
            'type': None,
            'default': None
        }
        if arg.annotation:
            try:
                if hasattr(ast, 'unparse'):
                    arg_info['type'] = ast.unparse(arg.annotation)
                elif isinstance(arg.annotation, ast.Name):
                    arg_info['type'] = arg.annotation.id
                elif isinstance(arg.annotation, ast.Constant):
                    arg_info['type'] = str(arg.annotation.value)
            except:
                arg_info['type'] = 'Any'
        args_list.append(arg_info)
    
    # Handle defaults
    if node.args.defaults:
        num_defaults = len(node.args.defaults)
        num_args = len(node.args.args)
        for i, default in enumerate(node.args.defaults):
            arg_idx = num_args - num_defaults + i
            if arg_idx < len(args_list):
                try:
                    if isinstance(default, ast.Constant):
                        args_list[arg_idx]['default'] = repr(default.value)
                    elif isinstance(default, ast.NameConstant):  # Python < 3.8
                        args_list[arg_idx]['default'] = repr(default.value)
                    elif isinstance(default, ast.Str):  # Python < 3.8
                        args_list[arg_idx]['default'] = repr(default.s)
                    elif hasattr(ast, 'unparse'):
                        args_list[arg_idx]['default'] = ast.unparse(default)
                except:
                    args_list[arg_idx]['default'] = '...'
    
    return args_list

def _extract_inputs_from_docstring(docstring):
    """Extract inputs/parameters from docstring"""
    inputs = []
    if not docstring:
        return inputs
    
    lines = docstring.split('\n')
    in_args = False
    for line in lines:
        line = line.strip()
        if line.startswith('Args:') or line.startswith('Parameters:'):
            in_args = True
            continue
        if in_args:
            if line.startswith('Returns:') or line.startswith('Yields:') or line.startswith('Raises:'):
                break
            if line and ':' in line and not line.startswith(' ' * 8):
                # Parameter line
                param_match = line.split(':', 1)
                if len(param_match) == 2:
                    param_name = param_match[0].strip()
                    param_desc = param_match[1].strip()
                    inputs.append({'name': param_name, 'description': param_desc})
            elif line.startswith(' ' * 4) and not line.startswith(' ' * 8):
                # Continuation of previous parameter
                if inputs:
                    inputs[-1]['description'] += ' ' + line.strip()
    
    return inputs

def _extract_outputs_from_docstring(docstring):
    """Extract return values from docstring"""
    outputs = []
    if not docstring:
        return outputs
    
    lines = docstring.split('\n')
    in_returns = False
    return_desc = []
    
    for line in lines:
        line = line.strip()
        if line.startswith('Returns:') or line.startswith('Return:'):
            in_returns = True
            continue
        if in_returns:
            if line.startswith('Args:') or line.startswith('Raises:') or line.startswith('Yields:'):
                break
            if line:
                return_desc.append(line)
    
    if return_desc:
        outputs.append({'description': ' '.join(return_desc)})
    
    return outputs

@app.route('/api/output/file/<path:file_path>', methods=['DELETE'])
def delete_output_file(file_path):
    """Delete a file or directory from the output directory"""
    try:
        output_dir = os.path.join(os.getcwd(), 'output')
        full_path = os.path.join(output_dir, file_path)
        
        # Security: ensure the path is within output directory
        full_path = os.path.abspath(full_path)
        output_dir_abs = os.path.abspath(output_dir)
        
        if not full_path.startswith(output_dir_abs):
            return jsonify({'error': 'Access denied'}), 403
        
        if not os.path.exists(full_path):
            return jsonify({'error': 'File not found'}), 404
        
        # Delete file or directory
        import shutil
        if os.path.isdir(full_path):
            shutil.rmtree(full_path)
        else:
            os.remove(full_path)
        
        return jsonify({'success': True, 'message': 'File deleted successfully'})
    except Exception as e:
        print_error(f"Error deleting file: {e}")
        import traceback
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

@app.route('/api/docs/lib/list', methods=['GET'])
def list_lib_files():
    """List files and directories in the lib directory"""
    try:
        lib_dir = os.path.join(_framework_root(), 'lib')
        rel_path = request.args.get('path', '')
        
        # Build full path
        if rel_path:
            full_path = os.path.join(lib_dir, rel_path)
        else:
            full_path = lib_dir
        
        # Security: ensure the path is within lib directory
        full_path = os.path.abspath(full_path)
        lib_dir_abs = os.path.abspath(lib_dir)
        
        if not full_path.startswith(lib_dir_abs):
            return jsonify({'error': 'Access denied'}), 403
        
        if not os.path.exists(full_path):
            return jsonify({'error': 'Path not found'}), 404
        
        if not os.path.isdir(full_path):
            return jsonify({'error': 'Not a directory'}), 400
        
        def _build_tree(dir_abs: str, rel_base: str = '') -> dict:
            """
            Build a recursive tree (like /api/modules/list) for lib/.
            - Keys are entry names
            - Each node has {name, path, is_file, children?, expanded}
            """
            tree = {}
            try:
                entries = []
                with os.scandir(dir_abs) as it:
                    for entry in it:
                        name = entry.name
                        if name.startswith('.') or name == '__pycache__':
                            continue
                        entries.append(entry)

                # Sort: directories first, then files, alphabetically
                entries.sort(key=lambda e: (not e.is_dir(), e.name.lower()))

                for entry in entries:
                    entry_rel = os.path.join(rel_base, entry.name) if rel_base else entry.name
                    entry_rel = entry_rel.replace('\\', '/')
                    try:
                        stat_info = entry.stat()
                    except Exception:
                        stat_info = None

                    if entry.is_dir(follow_symlinks=False):
                        children = _build_tree(entry.path, entry_rel)
                        tree[entry.name] = {
                            'name': entry.name,
                            'path': entry_rel,
                            'is_file': False,
                            'is_dir': True,
                            'expanded': False,
                            'children': children
                        }
                    else:
                        tree[entry.name] = {
                            'name': entry.name,
                            'path': entry_rel,
                            'is_file': True,
                            'is_dir': False,
                            'size': stat_info.st_size if stat_info else 0,
                            'modified': datetime.fromtimestamp(stat_info.st_mtime).isoformat() if stat_info else None
                        }
            except Exception as _e:
                print_error(f"Error building lib tree: {_e}")
            return tree

        # Build a full recursive tree starting from requested folder
        rel_root = os.path.relpath(full_path, lib_dir).replace('\\', '/')
        if rel_root == '.':
            rel_root = ''

        tree = _build_tree(full_path, rel_root)

        # Also return a flat listing of the requested folder (for potential future UI)
        files = []
        directories = []
        for name, node in tree.items():
            if node.get('is_file'):
                files.append({
                    'name': node.get('name'),
                    'path': node.get('path'),
                    'size': node.get('size', 0),
                    'modified': node.get('modified'),
                    'is_file': True,
                    'is_dir': False
                })
            else:
                directories.append({
                    'name': node.get('name'),
                    'path': node.get('path'),
                    'size': 0,
                    'modified': None,
                    'is_file': False,
                    'is_dir': True
                })
        
        return jsonify({
            'files': files,
            'directories': directories,
            'tree': tree,
            'path': rel_path.replace('\\', '/') if rel_path else '',
            'base_path': 'lib'
        })
    except Exception as e:
        print_error(f"Error listing lib directory: {e}")
        import traceback
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

@app.route('/api/docs/lib/file/<path:file_path>', methods=['GET'])
def get_lib_file(file_path):
    """Get file documentation (parsed functions/classes) from lib directory"""
    try:
        lib_dir = os.path.join(_framework_root(), 'lib')
        full_path = os.path.join(lib_dir, file_path)
        
        # Security: ensure the path is within lib directory
        full_path = os.path.abspath(full_path)
        lib_dir_abs = os.path.abspath(lib_dir)
        
        if not full_path.startswith(lib_dir_abs):
            return jsonify({'error': 'Access denied'}), 403
        
        if not os.path.exists(full_path):
            return jsonify({'error': 'File not found'}), 404
        
        if not os.path.isfile(full_path):
            return jsonify({'error': 'Not a file'}), 400
        
        stat_info = os.stat(full_path)
        extension = os.path.splitext(full_path)[1]
        
        file_info = {
            'name': os.path.basename(full_path),
            'path': file_path.replace('\\', '/'),
            'size': stat_info.st_size,
            'size_human': _format_size(stat_info.st_size),
            'modified': datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
            'created': datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
            'extension': extension
        }
        
        # Parse Python files to extract functions and classes
        if extension == '.py':
            parsed = _parse_python_functions(full_path)
            file_info.update(parsed)
        else:
            # For non-Python files, just read content
            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    file_info['content'] = f.read()
            except UnicodeDecodeError:
                with open(full_path, 'r', encoding='latin-1') as f:
                    file_info['content'] = f.read()
            file_info['functions'] = []
            file_info['classes'] = []
            file_info['module_docstring'] = ''
        
        return jsonify(file_info)
    except Exception as e:
        print_error(f"Error reading lib file: {e}")
        import traceback
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

@app.route('/api/plugins/list', methods=['GET'])
def list_plugins():
    """List all available plugins"""
    try:
        if framework and hasattr(framework, 'plugin_manager'):
            pm = framework.plugin_manager
            # Ensure plugins are loaded
            if not pm.plugins_loaded:
                pm.load_plugins()
            
            plugins = []
            for name, plugin_instance in pm.plugins.items():
                plugins.append({
                    'name': name,
                    'version': getattr(plugin_instance, 'version', '1.0'),
                    'description': getattr(plugin_instance, 'description', ''),
                    'author': getattr(plugin_instance, 'author', ''),
                    'enabled': True  # Plugins in the dict are loaded/enabled
                })
            
            return jsonify({'plugins': plugins})
        else:
            return jsonify({'plugins': []})
    except Exception as e:
        print_error(f"Error listing plugins: {e}")
        return jsonify({'plugins': [], 'error': str(e)}), 500

@app.route('/api/backdoor/modules', methods=['GET'])
def list_backdoor_modules():
    """List all backdoor and payload modules"""
    try:
        if framework and hasattr(framework, 'module_loader'):
            discovered = framework.module_loader.discover_modules()
            
            backdoors = []
            payloads = []
            
            for module_path, file_path in discovered.items():
                parts = module_path.split('/')
                module_type = parts[0] if len(parts) > 0 else 'other'
                
                if module_type == 'backdoors':
                    backdoors.append({
                        'path': module_path,
                        'name': parts[-1] if len(parts) > 0 else module_path,
                        'file_path': file_path
                    })
                elif module_type == 'payloads':
                    payloads.append({
                        'path': module_path,
                        'name': parts[-1] if len(parts) > 0 else module_path,
                        'file_path': file_path
                    })
            
            return jsonify({
                'backdoors': backdoors,
                'payloads': payloads
            })
        else:
            return jsonify({'backdoors': [], 'payloads': []})
    except Exception as e:
        print_error(f"Error listing backdoor modules: {e}")
        return jsonify({'backdoors': [], 'payloads': [], 'error': str(e)}), 500

@app.route('/api/backdoor/generate', methods=['POST'])
def generate_backdoor():
    """Generate a backdoor using a module"""
    try:
        data = request.json
        module_path = data.get('module_path')
        options = data.get('options', {})
        
        if not module_path:
            return jsonify({'error': 'Module path required'}), 400
        
        # Ensure framework is initialized
        global framework
        if not framework or not framework_initialized:
            init_framework()
        
        if not framework:
            return jsonify({'error': 'Framework not initialized'}), 500
        
        # Load the module using framework.load_module
        try:
            module_instance = framework.load_module(module_path)
            if not module_instance:
                return jsonify({'error': f'Failed to load module: {module_path}'}), 404
            
            # Set module options
            for opt_name, opt_value in options.items():
                if hasattr(module_instance, opt_name):
                    opt_attr = getattr(module_instance, opt_name)
                    if hasattr(opt_attr, 'value'):
                        opt_attr.value = opt_value
                    else:
                        setattr(module_instance, opt_name, opt_value)
            
            # Set framework reference and current module
            module_instance.framework = framework
            framework.current_module = module_instance
            
            # Execute the module
            import io
            import sys
            from contextlib import redirect_stdout, redirect_stderr
            
            output_buffer = io.StringIO()
            error_buffer = io.StringIO()
            
            with redirect_stdout(output_buffer), redirect_stderr(error_buffer):
                try:
                    result = framework.execute_module(use_runtime_kernel=True)
                    output = output_buffer.getvalue()
                    errors = error_buffer.getvalue()
                    
                    return jsonify({
                        'success': True,
                        'output': output,
                        'errors': errors,
                        'result': str(result) if result is not None else 'Completed'
                    })
                except Exception as e:
                    import traceback
                    error_msg = f"{str(e)}\n{traceback.format_exc()}"
                    return jsonify({
                        'success': False,
                        'error': error_msg,
                        'output': output_buffer.getvalue(),
                        'errors': error_buffer.getvalue()
                    }), 500
        except Exception as e:
            import traceback
            return jsonify({
                'success': False,
                'error': f'Error executing module: {str(e)}\n{traceback.format_exc()}'
            }), 500
            
    except Exception as e:
        import traceback
        print_error(f"Error generating backdoor: {e}")
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

@app.route('/api/web-delivery/start', methods=['POST'])
def web_delivery_start():
    """Start web delivery server"""
    global web_delivery_server, web_delivery_server_thread, web_delivery_server_port, web_delivery_file_path, web_delivery_random_path, web_delivery_running, web_delivery_job_id
    
    try:
        data = request.json or {}
        host = data.get('host', '0.0.0.0')
        port = data.get('port', 8080)
        file_path = data.get('file_path')
        
        if not file_path:
            return jsonify({'error': 'File path is required'}), 400
        
        # Stop existing server if running
        if web_delivery_running and web_delivery_server:
            try:
                web_delivery_server.shutdown()
                web_delivery_server.server_close()
            except:
                pass
            web_delivery_running = False
            
            # Update the existing job if any
            if web_delivery_job_id:
                from core.job_manager import global_job_manager
                global_job_manager.update_job_status(web_delivery_job_id, 'completed', output='Web delivery server stopped (replaced by new server)')
                web_delivery_job_id = None
        
        # Build full path to file
        output_dir = os.path.join(os.getcwd(), 'output')
        full_path = os.path.join(output_dir, file_path)
        full_path = os.path.abspath(full_path)
        output_dir_abs = os.path.abspath(output_dir)
        
        # Security: ensure the path is within output directory
        if not full_path.startswith(output_dir_abs):
            return jsonify({'error': 'Access denied'}), 403
        
        if not os.path.exists(full_path) or not os.path.isfile(full_path):
            return jsonify({'error': 'File not found'}), 404
        
        # Generate random 4-letter path
        import random
        import string
        random_path = ''.join(random.choices(string.ascii_lowercase, k=4))
        
        web_delivery_file_path = full_path
        web_delivery_random_path = random_path
        web_delivery_server_port = port
        
        # Create custom HTTP handler with closure to access file path and random path
        import http.server
        import socketserver
        import mimetypes
        
        # Store paths in closure
        handler_file_path = full_path
        handler_random_path = random_path
        
        class WebDeliveryHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, format, *args):
                # Suppress default logging
                pass
            
            def do_GET(self):
                # Serve file on random path only
                if self.path == f'/{handler_random_path}' or self.path == f'/{handler_random_path}/':
                    try:
                        # Determine content type
                        content_type, _ = mimetypes.guess_type(handler_file_path)
                        if content_type is None:
                            content_type = 'application/octet-stream'
                        
                        # Read file
                        with open(handler_file_path, 'rb') as f:
                            content = f.read()
                        
                        # Send response
                        self.send_response(200)
                        self.send_header('Content-Type', content_type)
                        self.send_header('Content-Length', str(len(content)))
                        self.send_header('Content-Disposition', f'attachment; filename="{os.path.basename(handler_file_path)}"')
                        self.end_headers()
                        self.wfile.write(content)
                        
                        # Log access
                        print_info(f"Web Delivery: {self.client_address[0]} downloaded {os.path.basename(handler_file_path)} via /{handler_random_path}")
                    except Exception as e:
                        self.send_error(500, f"Error serving file: {str(e)}")
                else:
                    # Return 404 for any other path
                    self.send_error(404, "Not Found")
        
        # Create and start server
        try:
            web_delivery_server = socketserver.TCPServer((host, port), WebDeliveryHandler)
            web_delivery_server.allow_reuse_address = True
            
            def run_server():
                global web_delivery_running
                web_delivery_running = True
                print_success(f"Web Delivery server started on http://{host}:{port}/{random_path}")
                web_delivery_server.serve_forever()
            
            web_delivery_server_thread = threading.Thread(target=run_server, daemon=True)
            web_delivery_server_thread.start()
            
            # Give server time to start
            import time
            time.sleep(0.5)
            
            # Create a job for the web delivery server
            from core.job_manager import global_job_manager
            job_id = global_job_manager.add_job(
                name='Web Delivery',
                description=f'Serving {os.path.basename(web_delivery_file_path)} on {host}:{port}/{random_path}',
                target=f'{host}:{port}/{random_path}',
                module=None
            )
            web_delivery_job_id = job_id
            
            return jsonify({
                'success': True,
                'url': f'http://{host}:{port}/{random_path}',
                'host': host,
                'port': port,
                'file': os.path.basename(web_delivery_file_path),
                'random_path': random_path,
                'job_id': job_id
            })
        except OSError as e:
            # Update job status if it was created before the error
            if web_delivery_job_id:
                from core.job_manager import global_job_manager
                error_msg = f'Port {port} is already in use' if 'Address already in use' in str(e) else f'Failed to start server: {str(e)}'
                global_job_manager.update_job_status(web_delivery_job_id, 'killed', error=error_msg)
                web_delivery_job_id = None
            if 'Address already in use' in str(e):
                return jsonify({'error': f'Port {port} is already in use'}), 400
            return jsonify({'error': f'Failed to start server: {str(e)}'}), 500
            
    except Exception as e:
        import traceback
        # Update job status if it was created before the error
        if web_delivery_job_id:
            from core.job_manager import global_job_manager
            global_job_manager.update_job_status(web_delivery_job_id, 'killed', error=str(e))
            web_delivery_job_id = None
        print_error(f"Error starting web delivery server: {e}")
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

@app.route('/api/web-delivery/stop', methods=['POST'])
def web_delivery_stop():
    """Stop web delivery server"""
    global web_delivery_server, web_delivery_running, web_delivery_job_id
    
    try:
        if web_delivery_running and web_delivery_server:
            web_delivery_server.shutdown()
            web_delivery_server.server_close()
            web_delivery_running = False
            
            # Update the associated job
            if web_delivery_job_id:
                from core.job_manager import global_job_manager
                global_job_manager.update_job_status(web_delivery_job_id, 'completed', output='Web delivery server stopped')
                web_delivery_job_id = None
            
            print_info("Web Delivery server stopped")
            return jsonify({'success': True, 'message': 'Server stopped'})
        else:
            return jsonify({'success': False, 'message': 'Server is not running'})
    except Exception as e:
        import traceback
        print_error(f"Error stopping web delivery server: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/web-delivery/status', methods=['GET'])
def web_delivery_status():
    """Get web delivery server status"""
    global web_delivery_server, web_delivery_running, web_delivery_server_port, web_delivery_file_path, web_delivery_random_path
    
    try:
        if web_delivery_running and web_delivery_server:
            import socket
            host = web_delivery_server.server_address[0]
            port = web_delivery_server.server_address[1]
            return jsonify({
                'running': True,
                'host': host,
                'port': port,
                'file': os.path.basename(web_delivery_file_path) if web_delivery_file_path else None,
                'random_path': web_delivery_random_path if web_delivery_random_path else None,
                'url': f'http://{host}:{port}/{web_delivery_random_path}' if web_delivery_random_path else None
            })
        else:
            return jsonify({'running': False})
    except Exception as e:
        return jsonify({'running': False, 'error': str(e)})

@app.route('/api/config/get', methods=['GET'])
def get_config():
    """Get configuration file content"""
    try:
        from core.config import Config
        config_instance = Config.get_instance()
        config_path = Path(config_instance.config_file)
        
        if not config_path.exists():
            return jsonify({'error': 'Configuration file not found'}), 404
        
        with open(config_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return jsonify({
            'success': True,
            'content': content,
            'path': str(config_path)
        })
    except Exception as e:
        import traceback
        print_error(f"Error reading config file: {e}")
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

@app.route('/api/config/save', methods=['POST'])
def save_config():
    """Save configuration file"""
    try:
        from core.config import Config
        data = request.json
        content = data.get('content')
        
        if content is None:
            return jsonify({'error': 'Content is required'}), 400
        
        config_instance = Config.get_instance()
        config_path = Path(config_instance.config_file)
        
        # Ensure parent directory exists
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write content to file
        with open(config_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Reload configuration
        try:
            config_instance.load_config()
        except Exception as reload_error:
            print_error(f"Warning: Config file saved but failed to reload: {reload_error}")
            # Still return success since file was saved
        
        return jsonify({
            'success': True,
            'message': 'Configuration saved successfully',
            'path': str(config_path)
        })
    except Exception as e:
        import traceback
        print_error(f"Error saving config file: {e}")
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

@app.route('/api/system/info', methods=['GET'])
def system_info():
    """Get system information including versions"""
    try:
        kittysploit_version = '2.0'
        kittyos_version = '1.0.0'
        contact = 'contact@kittysploit.com'
        
        # Try to get version from framework
        if framework and hasattr(framework, 'version'):
            kittysploit_version = framework.version
        
        # Try to get version from config
        try:
            from core.config import Config
            if hasattr(Config, 'VERSION'):
                kittysploit_version = Config.VERSION
        except:
            pass
        
        return jsonify({
            'kittysploit_version': kittysploit_version,
            'kittyos_version': kittyos_version,
            'contact': contact
        })
    except Exception as e:
        print_error(f"Error getting system info: {e}")
        return jsonify({
            'kittysploit_version': '2.0',
            'kittyos_version': '1.0.0',
            'contact': 'contact@kittysploit.com',
            'error': str(e)
        }), 500

@app.route('/api/hosts', methods=['GET'])
def get_hosts():
    """Get all discovered hosts from database"""
    try:
        if framework and framework.db_manager:
            hosts_data = []
            with framework.db_manager.session_scope('default') as session:
                hosts = session.query(Host).all()
                for host in hosts:
                    hosts_data.append({
                        'id': host.id,
                        'address': host.address,
                        'hostname': host.hostname if host.hostname else None,
                        'os': host.os if host.os else None,
                        'status': host.status if host.status else 'unknown',
                        'vulns_count': len(host.vulnerabilities),
                        'last_seen': host.updated_at.isoformat() if host.updated_at else (host.created_at.isoformat() if host.created_at else '')
                    })
            return jsonify({'hosts': hosts_data})
        else:
            return jsonify({'hosts': []})
    except Exception as e:
        print_error(f"Error getting hosts: {e}")
        return jsonify({'hosts': []})

@app.route('/api/targets', methods=['GET'])
def get_targets():
    """Get all targets used by modules (from Host database)"""
    try:
        if framework and framework.db_manager:
            targets_data = []
            with framework.db_manager.session_scope('default') as session:
                hosts = session.query(Host).all()
                for host in hosts:
                    # All hosts in database are considered targets
                    targets_data.append({
                        'address': host.address,
                        'hostname': host.hostname if host.hostname else None,
                        'os': host.os if host.os else None,
                        'status': host.status if host.status else 'unknown',
                        'vulns_count': len(host.vulnerabilities),
                        'last_seen': host.updated_at.isoformat() if host.updated_at else (host.created_at.isoformat() if host.created_at else '')
                    })
            return jsonify({'targets': targets_data})
        else:
            return jsonify({'targets': []})
    except Exception as e:
        print_error(f"Error getting targets: {e}")
        return jsonify({'targets': []})
        print_error(f"Error getting hosts: {e}")
        return jsonify({'hosts': []}), 500

@app.route('/api/commands/autocomplete', methods=['GET'])
def get_commands_autocomplete():
    """Get available commands for autocomplete"""
    try:
        ensure_terminal_backend()
        commands = []
        modules = []
        
        if command_registry and hasattr(command_registry, 'commands'):
            # Get all registered commands from the registry
            for cmd_name, cmd_obj in command_registry.commands.items():
                # Get description from the command object
                description = ''
                if hasattr(cmd_obj, 'description'):
                    description = cmd_obj.description
                elif hasattr(cmd_obj, '__doc__') and cmd_obj.__doc__:
                    description = cmd_obj.__doc__.strip().split('\n')[0]
                
                # Get usage
                usage = ''
                if hasattr(cmd_obj, 'usage'):
                    usage = cmd_obj.usage
                
                commands.append({
                    'name': cmd_name,
                    'description': description,
                    'usage': usage
                })
        
        # Add common framework commands if not already present
        common_commands = [
            'help', 'use', 'show', 'set', 'run', 'exploit', 'back', 'exit',
            'sessions', 'jobs', 'modules', 'plugins', 'workspace', 'search',
            'info', 'options', 'check', 'execute', 'shell', 'background',
            'clear', 'banner', 'interpreter', 'sync', 'debug', 'proxy',
            'demo', 'guardian', 'market', 'browser_server', 'compatible_payloads',
            'edit', 'network_discover', 'myip', 'history', 'plugin', 'generate',
            'host', 'vuln', 'sound', 'pattern', 'reset', 'syscall', 'irc', 'reload', 'portal'
        ]
        
        existing_names = {c['name'] for c in commands}
        for cmd in common_commands:
            if cmd not in existing_names:
                commands.append({'name': cmd, 'description': '', 'usage': ''})
        
        # Sort by name
        commands = sorted(commands, key=lambda x: x['name'])

        # Gather available modules for autocomplete contexts (use/info/etc.)
        if framework and hasattr(framework, 'module_loader'):
            try:
                discovered = framework.module_loader.discover_modules()
                if isinstance(discovered, dict):
                    modules = sorted(discovered.keys())
                elif isinstance(discovered, list):
                    modules = sorted(discovered)
            except Exception as module_err:
                print_error(f"Error discovering modules for autocomplete: {module_err}")
        
        return jsonify({'commands': commands, 'modules': modules})
        
    except Exception as e:
        print_error(f"Error getting commands for autocomplete: {e}")
        # Fallback list
        return jsonify({'commands': [
            {'name': 'help', 'description': 'Show help'},
            {'name': 'use', 'description': 'Use a module'},
            {'name': 'show', 'description': 'Show modules/options'},
            {'name': 'set', 'description': 'Set option'},
            {'name': 'run', 'description': 'Run module'},
            {'name': 'sessions', 'description': 'List sessions'},
            {'name': 'jobs', 'description': 'List jobs'},
            {'name': 'exit', 'description': 'Exit terminal'}
        ], 'modules': []})

@app.route('/api/interpreter/execute', methods=['POST'])
def execute_interpreter_code():
    """Execute Python code in the KittyPy interpreter"""
    try:
        ensure_terminal_backend()
        data = request.json
        code = data.get('code', '').strip()
        session_id = data.get('session_id', 'default')
        
        if not code:
            return jsonify({'error': 'No code provided', 'output': '', 'result': None}), 400
        
        # Import interpreter
        try:
            from core.interpreter import KittyInterpreter
        except ImportError:
            return jsonify({'error': 'Interpreter not available', 'output': '', 'result': None}), 500
        
        # Get or create interpreter for this session
        if not hasattr(execute_interpreter_code, 'interpreters'):
            execute_interpreter_code.interpreters = {}
        
        if session_id not in execute_interpreter_code.interpreters:
            if framework:
                execute_interpreter_code.interpreters[session_id] = KittyInterpreter(framework)
            else:
                return jsonify({'error': 'Framework not initialized', 'output': '', 'result': None}), 500
        
        interpreter = execute_interpreter_code.interpreters[session_id]
        
        # Redirect stdout and stderr
        import io
        import sys
        stdout = io.StringIO()
        stderr = io.StringIO()
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = stdout
        sys.stderr = stderr
        
        try:
            # Execute code
            result = interpreter.runsource(code)
            
            # Get outputs
            output = stdout.getvalue()
            error = stderr.getvalue()
            
            return jsonify({
                'output': output,
                'error': error if error else None,
                'result': None,  # runsource returns bool, not a result value
                'success': result is not False
            })
        except Exception as e:
            import traceback
            error_output = traceback.format_exc()
            return jsonify({
                'output': '',
                'error': str(e),
                'traceback': error_output,
                'success': False
            }), 500
        finally:
            # Restore stdout and stderr
            sys.stdout = old_stdout
            sys.stderr = old_stderr
            
    except Exception as e:
        print_error(f"Error executing interpreter code: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'output': '', 'result': None}), 500

@app.route('/api/terminal/history', methods=['GET'])
def get_terminal_history():
    """Return recent terminal command history"""
    try:
        ensure_terminal_backend()
        limit = request.args.get('limit', default=100, type=int)
        if not limit:
            limit = 100
        limit = max(1, min(limit, 1000))

        history_entries = []
        if command_registry:
            db_history = []
            try:
                if hasattr(command_registry, 'history_manager') and command_registry.history_manager:
                    db_history = command_registry.history_manager.get_history(limit=limit)
            except Exception as err:
                print_error(f"Error loading history from database: {err}")
                db_history = []

            if db_history:
                # history_manager returns newest first, so reverse for chronological order
                history_entries = [
                    {
                        'command': entry.get('command', ''),
                        'timestamp': entry.get('timestamp'),
                        'success': entry.get('success', True)
                    }
                    for entry in reversed(db_history)
                    if entry.get('command')
                ]
            else:
                local_history = getattr(command_registry, 'command_history', []) or []
                recent_local = local_history[-limit:]
                history_entries = [
                    {
                        'command': entry.get('command', ''),
                        'timestamp': entry.get('timestamp'),
                        'success': entry.get('success', True)
                    }
                    for entry in recent_local
                    if entry.get('command')
                ]

        return jsonify({'history': history_entries})
    except Exception as e:
        print_error(f"Error getting terminal history: {e}")
        return jsonify({'history': [], 'error': str(e)}), 500

@app.route('/api/workspaces', methods=['GET'])
def list_workspaces():
    """List all available workspaces"""
    try:
        if framework and hasattr(framework, 'workspace_manager'):
            workspaces = framework.workspace_manager.list_workspaces()
            current_workspace = framework.get_current_workspace_name()
            
            workspace_list = []
            for ws in workspaces:
                workspace_list.append({
                    'name': ws.name,
                    'description': ws.description or '',
                    'created_at': ws.created_at.isoformat() if ws.created_at else '',
                    'is_active': ws.is_active,
                    'is_current': ws.name == current_workspace
                })
            
            return jsonify({
                'workspaces': workspace_list,
                'current': current_workspace
            })
        else:
            return jsonify({'workspaces': [], 'current': 'default'})
    except Exception as e:
        print_error(f"Error listing workspaces: {e}")
        return jsonify({'workspaces': [], 'current': 'default', 'error': str(e)}), 500

@app.route('/api/workspaces/switch', methods=['POST'])
def switch_workspace():
    """Switch to a different workspace"""
    try:
        data = request.json
        workspace_name = data.get('name')
        
        if not workspace_name:
            return jsonify({'error': 'Workspace name is required'}), 400
        
        if framework and hasattr(framework, 'set_workspace'):
            success = framework.set_workspace(workspace_name)
            if success:
                add_activity('workspace_switched', f"Switched to workspace '{workspace_name}'", 'System')
                return jsonify({'success': True, 'workspace': workspace_name})
            else:
                return jsonify({'error': f'Failed to switch to workspace {workspace_name}'}), 500
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error switching workspace: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/workspaces/create', methods=['POST'])
def create_workspace():
    """Create a new workspace"""
    try:
        data = request.json
        workspace_name = data.get('name')
        description = data.get('description', '')
        
        if not workspace_name:
            return jsonify({'error': 'Workspace name is required'}), 400
        
        if framework and hasattr(framework, 'workspace_manager'):
            success = framework.workspace_manager.create_workspace(workspace_name, description)
            if success:
                add_activity('workspace_created', f"Created workspace '{workspace_name}'", 'System')
                return jsonify({'success': True, 'workspace': workspace_name})
            else:
                return jsonify({'error': f'Failed to create workspace {workspace_name}'}), 500
        else:
            return jsonify({'error': 'Framework not initialized'}), 500
    except Exception as e:
        print_error(f"Error creating workspace: {e}")
        return jsonify({'error': str(e)}), 500

def add_activity(activity_type, description, source='System'):
    """Helper to add activity and broadcast via WebSocket"""
    activity = {
        'type': activity_type,
        'description': description,
        'source': source,
        'timestamp': datetime.now().isoformat()
    }
    activity_feed.append(activity)
    
    # Keep only last 100
    if len(activity_feed) > 100:
        activity_feed.pop(0)
    
    # Broadcast to all connected clients
    if socketio:
        socketio.emit('new_activity', activity, namespace='/')

# Credential Vault API
@app.route('/api/credentials')
def get_credentials():
    cred_type = request.args.get('type')
    if cred_type:
        filtered = [c for c in credential_vault if c.get('type', '').lower() == cred_type.lower()]
        return jsonify({'credentials': filtered})
    return jsonify({'credentials': credential_vault})

@app.route('/api/credentials/add', methods=['POST'])
def add_credential():
    data = request.json
    credential = {
        **data,
        'timestamp': datetime.now().isoformat()
    }
    credential_vault.append(credential)
    
    # Notify
    add_activity('credential_found', f"New {data.get('type', 'credential')} harvested", data.get('source', 'Unknown'))
    
    return jsonify({'success': True})

# WebSocket Handlers
if SOCKETIO_AVAILABLE:
    @socketio.on('connect')
    def handle_connect():
        print_info(f"Client connected: {request.sid}")
        emit('connection_established', {'status': 'connected'})
        # Send current sound state to client
        if framework:
            if not hasattr(framework, 'sound_enabled'):
                framework.sound_enabled = False
            emit('sound_state_changed', {'enabled': framework.sound_enabled})
            
            # Send current Tor state to client
            if hasattr(framework, 'tor_manager'):
                try:
                    status = framework.get_tor_status()
                    emit('tor_status_response', {'status': status})
                except Exception as e:
                    print_error(f"Error sending Tor status: {e}")
    
    @socketio.on('disconnect')
    def handle_disconnect():
        print_info(f"Client disconnected: {request.sid}")
    
    @socketio.on('join_session')
    def handle_join_session(data):
        session_id = data.get('session_id')
        username = data.get('username', 'Anonymous')
        
        join_room(session_id)
        
        # Track active user
        if session_id not in active_users:
            active_users[session_id] = []
        active_users[session_id].append({'sid': request.sid, 'username': username})
        
        # Notify others in the room
        emit('user_joined', {
            'username': username,
            'active_users': [u['username'] for u in active_users.get(session_id, [])]
        }, room=session_id)
        
        add_activity('user_join', f'{username} joined session {session_id}', session_id)
    
    @socketio.on('leave_session')
    def handle_leave_session(data):
        session_id = data.get('session_id')
        leave_room(session_id)
        
        # Remove from active users
        if session_id in active_users:
            active_users[session_id] = [u for u in active_users[session_id] if u['sid'] != request.sid]
        
        emit('user_left', {'sid': request.sid}, room=session_id)
    
    @socketio.on('join_terminal_session')
    def handle_join_terminal_session(data):
        """Join a specific terminal session room to receive isolated output"""
        session_id = data.get('session_id')
        if session_id:
            join_room(session_id)
            
            # Ensure terminal backend is initialized
            ensure_terminal_backend()
            
            # Register a callback for this session in OutputHandler if not exists
            # Use the global output_handler (which should be the same as framework.output_handler)
            handler_to_use = output_handler
            if not handler_to_use and framework and hasattr(framework, 'output_handler'):
                handler_to_use = framework.output_handler
            
            if handler_to_use:
                # Define callback closure capturing session_id
                def session_output_callback(text):
                    if socketio:
                        # Emit to the specific room with session_id in the data
                        socketio.emit('terminal_output', {'text': text, 'session_id': session_id}, room=session_id)
                
                # Check for registry to avoid duplicate callbacks
                global terminal_callbacks
                if 'terminal_callbacks' not in globals():
                    terminal_callbacks = {}
                
                if session_id not in terminal_callbacks:
                    terminal_callbacks[session_id] = session_output_callback
                    handler_to_use.add_callback(session_id, session_output_callback)
                    # Also register for stderr
                    handler_to_use.add_callback(session_id, session_output_callback, is_stderr=True)
            
            # print_status(f"Client {request.sid} joined terminal session {session_id}")

    @socketio.on('terminal_input')
    def handle_terminal_input(data):
        """Broadcast terminal input and EXECUTE IT"""
        session_id = data.get('session_id')
        command = data.get('command')
        username = data.get('username', 'User')
        
        if not command or not command.strip():
            return

        # Detect if this is a "sound" command
        command_lower = command.strip().lower()
        is_sound_command = command_lower == 'sound' or command_lower.startswith('sound ')

        # 2. Execute Command
        global command_registry, output_handler
        if command_registry:
            def run_and_prompt(cmd, args, sess_id):
                try:
                    # Ensure terminal backend is initialized
                    ensure_terminal_backend()
                    
                    # Set thread context for OutputHandler
                    # Use the global output_handler (which should be the same as framework.output_handler)
                    handler_to_use = output_handler
                    if not handler_to_use and framework and hasattr(framework, 'output_handler'):
                        handler_to_use = framework.output_handler
                    
                    if handler_to_use:
                        handler_to_use.set_thread_context(sess_id)
                    
                    # Execute command
                    command_registry.execute_command(cmd, args, framework=framework)
                except Exception as e:
                    error_msg = f"Error: {e}\r\n"
                    if socketio:
                        socketio.emit('terminal_output', {'text': error_msg, 'session_id': sess_id}, room=sess_id)
                finally:
                    # If this was a sound command, update frontend icon after execution
                    if is_sound_command and framework:
                        if hasattr(framework, 'sound_enabled'):
                            # Emit socket event to update frontend icon with current state
                            if socketio:
                                socketio.emit('sound_state_changed', {
                                    'enabled': framework.sound_enabled
                                }, broadcast=True)
                    
                    # Print prompt after command finishes
                    prompt_msg = "\r\nkitty> "
                    if socketio:
                        socketio.emit('terminal_output', {'text': prompt_msg, 'session_id': sess_id}, room=sess_id)
                    
                    # Clear context
                    handler_to_use = output_handler
                    if not handler_to_use and framework and hasattr(framework, 'output_handler'):
                        handler_to_use = framework.output_handler
                    
                    if handler_to_use:
                        handler_to_use.clear_thread_context()

            # Run in thread with session_id
            threading.Thread(target=run_and_prompt, args=(command.split()[0], command.split()[1:], session_id)).start()
        else:
             socketio.emit('terminal_output', {'text': "Error: Backend not initialized.\r\n", 'session_id': session_id}, room=session_id if session_id else '/')

    @socketio.on('team_message_send')
    def handle_team_message(data):
        """Broadcast chat message to all connected operators (Team Chat)"""
        # Save to history
        msg = {
            'sender': data.get('sender', 'Anonymous'),
            'message': data.get('message', ''),
            'timestamp': datetime.now().isoformat()
        }
        chat_history.append(msg)
        # Keep last 100 messages
        if len(chat_history) > 100:
            chat_history.pop(0)

        emit('team_message', msg, broadcast=True)

    @socketio.on('request_chat_history')
    def handle_request_chat_history():
        emit('chat_history', {'history': chat_history})
    
    @socketio.on('irc_connect')
    def handle_irc_connect(data):
        """Connect user to real IRC server"""
        nickname = data.get('nickname', 'Guest')
        
        if irc_bridge:
            actual_nick = irc_bridge.connect_user(nickname, request.sid)
            if actual_nick:
                emit('irc_connected', {
                    'success': True,
                    'nickname': actual_nick,
                    'server': 'irc.libera.chat',
                    'channel': '#KittySploit'
                })
            else:
                emit('irc_error', {'error': 'Failed to connect to IRC server'})
        else:
            emit('irc_error', {'error': 'IRC bridge not available'})
    
    @socketio.on('irc_send_message')
    def handle_irc_message(data):
        """Send message to real IRC channel"""
        nickname = data.get('nickname')
        message = data.get('message', '')
        
        if irc_bridge and nickname and message:
            if irc_bridge.send_message(nickname, message):
                # Echo to web clients (also avoids "missing message" when
                # server echo isn't processed/broadcast due to per-user connections)
                try:
                    irc_bridge.broadcast_to_web(nickname, message)
                except Exception:
                    pass
            else:
                emit('irc_error', {'error': 'Failed to send message'})
    
    @socketio.on('irc_disconnect')
    def handle_irc_disconnect(data):
        """Disconnect from IRC"""
        nickname = data.get('nickname')
        if irc_bridge and nickname:
            irc_bridge.disconnect_user(nickname)
    
    # --- TOR NETWORK MANAGEMENT ---
    @socketio.on('tor_connect')
    def handle_tor_connect(data):
        """Enable Tor network"""
        try:
            if not framework:
                emit('tor_error', {'error': 'Framework not available'})
                return
            
            socks_proxy = data.get('socks_proxy', '127.0.0.1:9050')
            control_port = data.get('control_port', '127.0.0.1:9051')
            
            # Parse SOCKS proxy
            if ':' in socks_proxy:
                host, port = socks_proxy.rsplit(':', 1)
                try:
                    socks_port = int(port)
                except ValueError:
                    emit('tor_error', {'error': f'Invalid SOCKS port: {port}'})
                    return
            else:
                host = socks_proxy
                socks_port = 9050
            
            # Parse control port
            control_host = '127.0.0.1'
            if ':' in control_port:
                control_host, control_port_str = control_port.rsplit(':', 1)
                try:
                    control_port_num = int(control_port_str)
                except ValueError:
                    control_port_num = 9051
            else:
                try:
                    control_port_num = int(control_port)
                except ValueError:
                    control_port_num = 9051
            
            # Enable Tor
            result = framework.enable_tor(
                host=host,
                socks_port=socks_port,
                control_port=control_port_num,
                check_availability=True,
                save_config=True
            )
            
            if result:
                status = framework.get_tor_status()
                emit('tor_connected', {
                    'success': True,
                    'status': status
                }, broadcast=True)
            else:
                emit('tor_error', {'error': 'Failed to enable Tor. Make sure Tor is running.'})
        except Exception as e:
            emit('tor_error', {'error': f'Error enabling Tor: {str(e)}'})
    
    @socketio.on('tor_disconnect')
    def handle_tor_disconnect():
        """Disable Tor network"""
        try:
            if not framework:
                emit('tor_error', {'error': 'Framework not available'})
                return
            
            framework.disable_tor(save_config=True)
            status = framework.get_tor_status()
            emit('tor_disconnected', {
                'success': True,
                'status': status
            }, broadcast=True)
        except Exception as e:
            emit('tor_error', {'error': f'Error disabling Tor: {str(e)}'})
    
    @socketio.on('tor_status')
    def handle_tor_status():
        """Get current Tor status"""
        try:
            if not framework:
                emit('tor_status_response', {'error': 'Framework not available'})
                return
            
            status = framework.get_tor_status()
            emit('tor_status_response', {'status': status})
        except Exception as e:
            emit('tor_status_response', {'error': f'Error getting Tor status: {str(e)}'})
    
    # REST API endpoints for Tor
    @app.route('/api/tor/status', methods=['GET'])
    def api_tor_status():
        """Get Tor network status"""
        try:
            if not framework:
                return jsonify({'error': 'Framework not available'}), 500
            
            status = framework.get_tor_status()
            return jsonify({'success': True, 'status': status})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    @app.route('/api/tor/enable', methods=['POST'])
    def api_tor_enable():
        """Enable Tor network"""
        try:
            if not framework:
                return jsonify({'error': 'Framework not available'}), 500
            
            data = request.json or {}
            host = data.get('host', '127.0.0.1')
            socks_port = data.get('socks_port')
            control_port = data.get('control_port')
            check_availability = data.get('check_availability', True)
            
            result = framework.enable_tor(
                host=host,
                socks_port=socks_port,
                control_port=control_port,
                check_availability=check_availability,
                save_config=True
            )
            
            if result:
                status = framework.get_tor_status()
                # Broadcast to all connected clients
                if socketio:
                    socketio.emit('tor_connected', {
                        'success': True,
                        'status': status
                    }, broadcast=True)
                return jsonify({'success': True, 'status': status})
            else:
                return jsonify({'error': 'Failed to enable Tor. Make sure Tor is running.'}), 400
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    @app.route('/api/tor/disable', methods=['POST'])
    def api_tor_disable():
        """Disable Tor network"""
        try:
            if not framework:
                return jsonify({'error': 'Framework not available'}), 500
            
            framework.disable_tor(save_config=True)
            status = framework.get_tor_status()
            
            # Broadcast to all connected clients
            if socketio:
                socketio.emit('tor_disconnected', {
                    'success': True,
                    'status': status
                }, broadcast=True)
            
            return jsonify({'success': True, 'status': status})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    @app.route('/api/tor/check', methods=['POST'])
    def api_tor_check():
        """Check if Tor is available"""
        try:
            if not framework:
                return jsonify({'error': 'Framework not available'}), 500
            
            data = request.json or {}
            host = data.get('host', '127.0.0.1')
            port = data.get('port', 9050)
            
            available = framework.check_tor_available(host, port)
            return jsonify({'success': True, 'available': available, 'host': host, 'port': port})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    # --- NETWORK & SYSTEM MONITORING ---
    @socketio.on('get_hosts')
    def handle_get_hosts():
        """Get discovered hosts and vulnerabilities"""
        if framework and framework.db_manager:
            try:
                hosts_data = []
                vulns_data = []
                
                # Use session scope to query database
                with framework.db_manager.session_scope('default') as session:
                    # Query all hosts
                    hosts = session.query(Host).all()
                    
                    for host in hosts:
                        # Count vulnerabilities
                        vulns_count = len(host.vulnerabilities)
                        
                        hosts_data.append({
                            'id': host.id,
                            'address': host.address,
                            'hostname': host.hostname if host.hostname else 'Unknown',
                            'os': host.os if host.os else 'Unknown',
                            'status': host.status if host.status else 'unknown',
                            'vulns_count': vulns_count,
                            'last_seen': host.updated_at.isoformat() if host.updated_at else (host.created_at.isoformat() if host.created_at else '')
                        })
                        
                        # Process vulnerabilities for this host
                        for vuln in host.vulnerabilities:
                            vulns_data.append({
                                'id': vuln.id,
                                'host_id': host.id,
                                'name': vuln.name,
                                'severity': vuln.risk_level,
                                'host': host.address,
                                'description': vuln.description,
                                'cve': vuln.cve
                            })
                
                emit('hosts_data', {
                    'hosts': hosts_data,
                    'vulns': vulns_data
                })
                
            except Exception as e:
                import traceback
                traceback.print_exc()
                emit('hosts_data', {'error': f"Failed to get hosts: {str(e)}"})
        else:
            emit('hosts_data', {'error': 'Framework not available'})
    
    @socketio.on('get_ports')
    def handle_get_ports():
        """Get local open ports"""
        import socket
        import psutil
        
        try:
            ports_data = []
            connections = psutil.net_connections(kind='inet')
            
            for conn in connections:
                if conn.status == 'LISTEN':
                    try:
                        process = psutil.Process(conn.pid) if conn.pid else None
                        process_name = process.name() if process else 'Unknown'
                    except:
                        process_name = 'Unknown'
                    
                    ports_data.append({
                        'port': conn.laddr.port,
                        'address': conn.laddr.ip,
                        'protocol': 'TCP' if conn.type == socket.SOCK_STREAM else 'UDP',
                        'process': process_name,
                        'pid': conn.pid
                    })
            
            # Sort by port number
            ports_data.sort(key=lambda x: x['port'])
            
            emit('ports_data', {'ports': ports_data})
        except Exception as e:
            emit('ports_data', {'error': str(e)})
    
    @socketio.on('get_system_stats')
    def handle_get_system_stats():
        """Get system statistics (CPU, RAM, Disk, IP)"""
        import psutil
        import socket
        
        try:
            # Get IP address
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                s.connect(('8.8.8.8', 80))
                ip_address = s.getsockname()[0]
            except:
                ip_address = '127.0.0.1'
            finally:
                s.close()
            
            # Get system stats
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            emit('system_stats', {
                'ip': ip_address,
                'cpu': round(cpu_percent, 1),
                'ram': round(memory.percent, 1),
                'disk': round(disk.percent, 1)
            })
        except Exception as e:
            emit('system_stats', {'error': str(e)})
    
    # --- PROXY CONTROL HANDLERS ---
    @socketio.on('proxy_start')
    def handle_proxy_start(data):
        """Start KittyProxy"""
        try:
            # Ensure framework is initialized
            if not framework:
                init_framework()
            
            proxy_port = data.get('proxy_port', 8080)
            api_port = data.get('api_port', 8000)

            # Initialize proxy_manager if not already done
            global proxy_manager
            if not proxy_manager:
                if framework:
                    proxy_manager = ProxyManager(framework)
                else:
                    emit('proxy_status', {
                        'success': False, 
                        'running': False, 
                        'error': 'Framework not initialized. Please wait and try again.'
                    })
                    return

            if proxy_manager:
                result = proxy_manager.start_proxy(proxy_port, api_port)
                # Add running flag based on success
                if result.get('success'):
                    result['running'] = True
                else:
                    result['running'] = False
                emit('proxy_status', result)
            else:
                emit('proxy_status', {
                    'success': False, 
                    'running': False, 
                    'error': 'Proxy manager not available'
                })
        except Exception as e:
            print_error(f"Error starting proxy: {e}")
            import traceback
            traceback.print_exc()
            emit('proxy_status', {
                'success': False, 
                'running': False, 
                'error': f'Error starting proxy: {str(e)}'
            })
    
    @socketio.on('proxy_stop')
    def handle_proxy_stop():
        """Stop KittyProxy"""
        if proxy_manager:
            result = proxy_manager.stop_proxy()
            emit('proxy_status', result)
        else:
            emit('proxy_status', {'success': False, 'error': 'Proxy manager not available'})
    
    @socketio.on('proxy_get_status')
    def handle_proxy_get_status():
        """Get proxy status"""
        if proxy_manager:
            status = proxy_manager.get_status()
            emit('proxy_status', status)
        else:
            emit('proxy_status', {'running': False})
    
    @socketio.on('sound_toggle')
    def handle_sound_toggle(data):
        """Handle sound toggle from frontend icon click"""
        enabled = data.get('enabled', False)
        if framework:
            if not hasattr(framework, 'sound_enabled'):
                framework.sound_enabled = False
            framework.sound_enabled = enabled
            # Broadcast to all clients to sync state
            socketio.emit('sound_state_changed', {'enabled': enabled}, broadcast=True)

# Docker Environments API
@app.route('/api/docker_environments/list', methods=['GET'])
def list_docker_environments():
    """List all available Docker environments from dockers_environements modules"""
    try:
        environments = []
        
        if framework and hasattr(framework, 'module_loader'):
            # Discover modules in dockers_environements directory
            discovered = framework.module_loader.discover_modules()
            
            for module_path, file_path in discovered.items():
                # Filter for dockers_environements modules
                if 'dockers_environements' in module_path or 'docker' in module_path.lower():
                    # Try to load module to get metadata
                    try:
                        module_instance = framework.load_module(module_path)
                        if module_instance:
                            env_info = {
                                'name': module_path.split('/')[-1],
                                'module_path': module_path,
                                'file_path': file_path,
                                'description': getattr(module_instance, 'DESCRIPTION', '') or getattr(module_instance, '__doc__', '') or '',
                                'status': 'stopped',
                                'container_name': None,
                                'image': None,
                                'web_port': None
                            }
                            
                            # Try to get container info from module attributes
                            if hasattr(module_instance, 'CONTAINER_NAME'):
                                env_info['container_name'] = module_instance.CONTAINER_NAME
                            if hasattr(module_instance, 'IMAGE'):
                                env_info['image'] = module_instance.IMAGE
                            if hasattr(module_instance, 'WEB_PORT'):
                                env_info['web_port'] = module_instance.WEB_PORT
                            
                            # Check if container is running
                            if env_info['container_name']:
                                import subprocess
                                try:
                                    result = subprocess.run(
                                        ['docker', 'ps', '--filter', f'name={env_info["container_name"]}', '--format', '{{.Names}}'],
                                        capture_output=True,
                                        text=True,
                                        timeout=5
                                    )
                                    if result.returncode == 0 and env_info['container_name'] in result.stdout:
                                        env_info['status'] = 'running'
                                except:
                                    pass
                            
                            environments.append(env_info)
                    except Exception as e:
                        # If we can't load the module, still add basic info
                        environments.append({
                            'name': module_path.split('/')[-1],
                            'module_path': module_path,
                            'file_path': file_path,
                            'description': '',
                            'status': 'unknown',
                            'container_name': None,
                            'image': None,
                            'web_port': None,
                            'error': str(e)
                        })
        
        return jsonify({'environments': environments})
    except Exception as e:
        print_error(f"Error listing docker environments: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'environments': [], 'error': str(e)}), 500

@app.route('/api/docker_environments/<env_name>/start', methods=['POST'])
def start_docker_environment(env_name):
    """Start a Docker environment"""
    try:
        if not framework or not hasattr(framework, 'module_loader'):
            return jsonify({'success': False, 'error': 'Framework not initialized'}), 500
        
        # Find the module
        discovered = framework.module_loader.discover_modules()
        module_path = None
        for path in discovered.keys():
            if env_name in path and ('dockers_environements' in path or 'docker' in path.lower()):
                module_path = path
                break
        
        if not module_path:
            return jsonify({'success': False, 'error': f'Environment "{env_name}" not found'}), 404
        
        # Load and execute the module
        try:
            module_instance = framework.load_module(module_path)
            if not module_instance:
                return jsonify({'success': False, 'error': f'Failed to load module: {module_path}'}), 500
            
            # Set framework reference
            module_instance.framework = framework
            framework.current_module = module_instance
            
            # Execute the module (which should start the docker container)
            import io
            import sys
            from contextlib import redirect_stdout, redirect_stderr
            
            output_buffer = io.StringIO()
            error_buffer = io.StringIO()
            
            with redirect_stdout(output_buffer), redirect_stderr(error_buffer):
                if hasattr(module_instance, 'run'):
                    module_instance.run()
                elif hasattr(module_instance, 'execute'):
                    module_instance.execute()
                else:
                    # Try calling the module directly
                    module_instance()
            
            output = output_buffer.getvalue()
            errors = error_buffer.getvalue()
            
            if errors:
                print_error(f"Docker environment start errors: {errors}")
            
            add_activity('docker_started', f"Docker environment '{env_name}' started", 'System')
            return jsonify({'success': True, 'output': output})
            
        except Exception as e:
            import traceback
            error_msg = str(e)
            if app.debug:
                error_msg += f"\n{traceback.format_exc()}"
            return jsonify({'success': False, 'error': error_msg}), 500
            
    except Exception as e:
        print_error(f"Error starting docker environment: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/docker_environments/<env_name>/stop', methods=['POST'])
def stop_docker_environment(env_name):
    """Stop a Docker environment"""
    try:
        if not framework or not hasattr(framework, 'module_loader'):
            return jsonify({'success': False, 'error': 'Framework not initialized'}), 500
        
        # Find the module to get container name
        discovered = framework.module_loader.discover_modules()
        module_path = None
        container_name = None
        
        for path in discovered.keys():
            if env_name in path and ('dockers_environements' in path or 'docker' in path.lower()):
                module_path = path
                try:
                    module_instance = framework.load_module(path)
                    if module_instance and hasattr(module_instance, 'CONTAINER_NAME'):
                        container_name = module_instance.CONTAINER_NAME
                except:
                    pass
                break
        
        if not container_name:
            return jsonify({'success': False, 'error': f'Container name not found for environment "{env_name}"'}), 404
        
        # Stop the container using docker command
        import subprocess
        try:
            result = subprocess.run(
                ['docker', 'stop', container_name],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                add_activity('docker_stopped', f"Docker environment '{env_name}' stopped", 'System')
                return jsonify({'success': True, 'output': result.stdout})
            else:
                return jsonify({'success': False, 'error': result.stderr or 'Failed to stop container'}), 500
                
        except subprocess.TimeoutExpired:
            return jsonify({'success': False, 'error': 'Timeout while stopping container'}), 500
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
            
    except Exception as e:
        print_error(f"Error stopping docker environment: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/docker_environments/<env_name>/logs', methods=['GET'])
def get_docker_environment_logs(env_name):
    """Get logs from a Docker environment"""
    try:
        if not framework or not hasattr(framework, 'module_loader'):
            return jsonify({'success': False, 'error': 'Framework not initialized'}), 500
        
        # Find the module to get container name
        discovered = framework.module_loader.discover_modules()
        container_name = None
        
        for path in discovered.keys():
            if env_name in path and ('dockers_environements' in path or 'docker' in path.lower()):
                try:
                    module_instance = framework.load_module(path)
                    if module_instance and hasattr(module_instance, 'CONTAINER_NAME'):
                        container_name = module_instance.CONTAINER_NAME
                except:
                    pass
                break
        
        if not container_name:
            return jsonify({'success': False, 'error': f'Container name not found for environment "{env_name}"'}), 404
        
        # Get logs using docker command
        import subprocess
        try:
            lines = request.args.get('lines', '100')
            result = subprocess.run(
                ['docker', 'logs', '--tail', str(lines), container_name],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                return jsonify({'success': True, 'logs': result.stdout})
            else:
                return jsonify({'success': False, 'error': result.stderr or 'Failed to get logs'}), 500
                
        except subprocess.TimeoutExpired:
            return jsonify({'success': False, 'error': 'Timeout while getting logs'}), 500
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
            
    except Exception as e:
        print_error(f"Error getting docker environment logs: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    init_framework()
    # Start RPC in background
    start_rpc_server()
    # Start KittyCollab server in background
    start_collab_server()
    
    print("Registered Routes:")
    print(app.url_map)
    
    if SOCKETIO_AVAILABLE and socketio:
        print_success("Starting with WebSocket support (SocketIO)")
        socketio.run(app, host='127.0.0.1', port=5005, debug=True, use_reloader=False)
    else:
        print_info("Starting without WebSocket support")
        app.run(host='127.0.0.1', port=5005, debug=True, use_reloader=False)
