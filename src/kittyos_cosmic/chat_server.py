#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Chat Server Manager for KittyOS
Manages multiple chat servers and client connections
"""

import threading
import time
from datetime import datetime
from collections import defaultdict

class ChatServerManager:
    """Manages chat servers and client connections"""
    
    def __init__(self, socketio):
        self.socketio = socketio
        self.servers = {}  # server_id -> ChatServer
        self.clients = {}  # socket_sid -> ClientInfo
        self.lock = threading.Lock()
    
    def create_server(self, server_id, server_name, password=None, max_users=100):
        """Create a new chat server"""
        with self.lock:
            if server_id in self.servers:
                return False, "Server already exists"
            
            server = ChatServer(server_id, server_name, password, max_users)
            self.servers[server_id] = server
            return True, server
    
    def delete_server(self, server_id):
        """Delete a chat server"""
        with self.lock:
            if server_id not in self.servers:
                return False, "Server not found"
            
            server = self.servers[server_id]
            # Disconnect all clients
            for client_sid in list(server.clients.keys()):
                self.disconnect_client(client_sid)
            
            del self.servers[server_id]
            return True, "Server deleted"
    
    def list_servers(self):
        """List all available chat servers"""
        with self.lock:
            servers_list = []
            for server_id, server in self.servers.items():
                servers_list.append({
                    'id': server_id,
                    'name': server.name,
                    'has_password': server.password is not None,
                    'users_count': len(server.clients),
                    'max_users': server.max_users,
                    'created_at': server.created_at.isoformat()
                })
            return servers_list
    
    def connect_client(self, socket_sid, server_id, username, password=None):
        """Connect a client to a chat server"""
        with self.lock:
            if server_id not in self.servers:
                return False, "Server not found"
            
            server = self.servers[server_id]
            
            # Check password
            if server.password and server.password != password:
                return False, "Invalid password"
            
            # Check max users
            if len(server.clients) >= server.max_users:
                return False, "Server is full"
            
            # Check if username is already taken
            for client in server.clients.values():
                if client.username == username:
                    return False, "Username already taken"
            
            # Create client info
            client_info = ClientInfo(socket_sid, username, server_id)
            server.clients[socket_sid] = client_info
            self.clients[socket_sid] = client_info
            
            # Broadcast user joined message
            server.add_message({
                'type': 'system',
                'sender': '[System]',
                'message': f'{username} joined the chat',
                'timestamp': datetime.now().isoformat()
            })
            
            return True, client_info
    
    def disconnect_client(self, socket_sid):
        """Disconnect a client from a chat server"""
        with self.lock:
            if socket_sid not in self.clients:
                return
            
            client_info = self.clients[socket_sid]
            server_id = client_info.server_id
            
            if server_id in self.servers:
                server = self.servers[server_id]
                if socket_sid in server.clients:
                    username = server.clients[socket_sid].username
                    del server.clients[socket_sid]
                    
                    # Broadcast user left message
                    server.add_message({
                        'type': 'system',
                        'sender': '[System]',
                        'message': f'{username} left the chat',
                        'timestamp': datetime.now().isoformat()
                    })
            
            del self.clients[socket_sid]
    
    def send_message(self, socket_sid, message):
        """Send a message from a client"""
        with self.lock:
            if socket_sid not in self.clients:
                return False, "Client not connected"
            
            client_info = self.clients[socket_sid]
            server_id = client_info.server_id
            
            if server_id not in self.servers:
                return False, "Server not found"
            
            server = self.servers[server_id]
            username = client_info.username
            
            msg = {
                'type': 'user',
                'sender': username,
                'message': message,
                'timestamp': datetime.now().isoformat()
            }
            
            server.add_message(msg)
            return True, msg
    
    def get_server_info(self, server_id):
        """Get information about a server"""
        with self.lock:
            if server_id not in self.servers:
                return None
            
            server = self.servers[server_id]
            return {
                'id': server_id,
                'name': server.name,
                'has_password': server.password is not None,
                'users': [client.username for client in server.clients.values()],
                'users_count': len(server.clients),
                'max_users': server.max_users,
                'created_at': server.created_at.isoformat()
            }
    
    def get_message_history(self, server_id, limit=100):
        """Get message history for a server"""
        with self.lock:
            if server_id not in self.servers:
                return []
            
            server = self.servers[server_id]
            return server.get_messages(limit)


class ChatServer:
    """Represents a single chat server"""
    
    def __init__(self, server_id, name, password=None, max_users=100):
        self.server_id = server_id
        self.name = name
        self.password = password
        self.max_users = max_users
        self.clients = {}  # socket_sid -> ClientInfo
        self.messages = []  # Message history
        self.created_at = datetime.now()
        self.lock = threading.Lock()
    
    def add_message(self, message):
        """Add a message to history and broadcast it"""
        with self.lock:
            self.messages.append(message)
            # Keep last 500 messages
            if len(self.messages) > 500:
                self.messages.pop(0)
        
        # Broadcast to all clients in this server
        # This will be handled by the socketio handlers
    
    def get_messages(self, limit=100):
        """Get recent messages"""
        with self.lock:
            return self.messages[-limit:]


class ClientInfo:
    """Information about a connected client"""
    
    def __init__(self, socket_sid, username, server_id):
        self.socket_sid = socket_sid
        self.username = username
        self.server_id = server_id
        self.connected_at = datetime.now()
