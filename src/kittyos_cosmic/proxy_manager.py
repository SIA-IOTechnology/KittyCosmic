#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
KittyProxy Manager for Web UI
Manages KittyProxy instance from the web interface
"""

import sys
import os
import threading
import time


def _framework_root():
    """Directory containing ``interfaces/`` and ``lib/`` (KittySploit project root)."""
    p = os.path.abspath(os.path.dirname(__file__))
    for _ in range(24):
        if (
            os.path.isdir(os.path.join(p, 'interfaces', 'kittyproxy'))
            and os.path.isfile(os.path.join(p, 'interfaces', 'kittyproxy', 'proxy_core.py'))
        ):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            break
        p = parent
    return None


class ProxyManager:
    """Manager for KittyProxy instance"""
    
    def __init__(self, framework=None):
        self.framework = framework
        self.proxy = None
        self.api_thread = None
        self.proxy_port = 8080
        self.api_port = 8000
        self.api_host = '127.0.0.1'
        self.running = False
        self._stop_event = threading.Event()
    
    def start_proxy(self, proxy_port=8080, api_port=8000):
        """Start KittyProxy in background thread"""
        if self.running:
            return {"success": False, "error": "Proxy already running"}
        
        try:
            root = _framework_root()
            if not root:
                return {
                    "success": False,
                    "error": "Could not locate KittySploit root (interfaces/kittyproxy).",
                }
            if root not in sys.path:
                sys.path.insert(0, root)

            from interfaces.kittyproxy.proxy_core import MitmProxyWrapper
            from interfaces.kittyproxy.api import app, set_framework

            # Check dependencies
            try:
                from mitmproxy import http
                import uvicorn
            except ImportError as e:
                return {"success": False, "error": f"Missing dependency: {e}"}
            
            # Set framework
            if self.framework:
                set_framework(self.framework)
            
            # Configure ports
            self.proxy_port = proxy_port
            self.api_port = api_port
            
            # Start mitmproxy
            self.proxy = MitmProxyWrapper(
                host="127.0.0.1",
                port=self.proxy_port,
                api_host=self.api_host,
                api_port=self.api_port
            )
            self.proxy.start()
            
            # Start API server in thread
            def run_api():
                try:
                    uvicorn.run(
                        app,
                        host=self.api_host,
                        port=self.api_port,
                        log_level="warning"
                    )
                except Exception as e:
                    print(f"API server error: {e}")
            
            self.api_thread = threading.Thread(target=run_api, daemon=True)
            self.api_thread.start()
            
            # Wait for startup
            time.sleep(2)
            
            self.running = True
            
            return {
                "success": True,
                "proxy_port": self.proxy_port,
                "api_port": self.api_port,
                "api_url": f"http://{self.api_host}:{self.api_port}"
            }
            
        except Exception as e:
            self.running = False
            return {"success": False, "error": str(e)}
    
    def stop_proxy(self):
        """Stop KittyProxy"""
        if not self.running:
            return {"success": False, "error": "Proxy not running"}
        
        try:
            # Stop mitmproxy
            if self.proxy:
                self.proxy.stop()
                self.proxy = None
            
            self.running = False
            
            return {"success": True, "message": "Proxy stopped"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_status(self):
        """Get proxy status"""
        return {
            "running": self.running,
            "proxy_port": self.proxy_port if self.running else None,
            "api_port": self.api_port if self.running else None,
            "api_url": f"http://{self.api_host}:{self.api_port}" if self.running else None
        }
