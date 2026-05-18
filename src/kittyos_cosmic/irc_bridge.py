#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
IRC Bridge for Web UI
Connects the web IRC interface to the real IRC server (irc.libera.chat #KittySploit)
"""

import socket
import ssl
import threading
import time
import re
from datetime import datetime

class WebIRCBridge:
    """Bridge between Web UI and IRC server"""
    
    def __init__(self, socketio):
        self.socketio = socketio
        self.server = 'irc.libera.chat'
        self.port = 6697
        self.channel = '#KittySploit'
        self.clients = {}  # nickname -> socket_sid mapping
        self.irc_connections = {}  # nickname -> IRCConnection
        self.lock = threading.Lock()
        # Dedupe cache: key -> last_seen_epoch
        self._recent = {}
        self._recent_ttl_sec = 2.0
        self._recent_max = 500
    
    def connect_user(self, nickname, socket_sid):
        """Connect a user to IRC"""
        with self.lock:
            if nickname in self.irc_connections:
                # Already connected, just map the socket
                self.clients[nickname] = socket_sid
                return nickname
            
            # Create new IRC connection
            conn = IRCConnection(nickname, self.server, self.port, self.channel, self)
            if conn.connect():
                self.irc_connections[nickname] = conn
                self.clients[nickname] = socket_sid
                
                # Start receive thread
                thread = threading.Thread(target=conn.receive_messages, daemon=True)
                thread.start()
                
                # Wait for registration (001) so JOIN/PRIVMSG are reliable
                max_wait = 10.0
                waited = 0.0
                while not conn.registered and waited < max_wait:
                    time.sleep(0.25)
                    waited += 0.25
                if not conn.registered:
                    conn.disconnect()
                    del self.irc_connections[nickname]
                    del self.clients[nickname]
                    return None

                # If server forced a nick change (433), re-key mappings
                actual_nick = conn.nickname or nickname
                if actual_nick != nickname:
                    self.irc_connections[actual_nick] = conn
                    self.clients[actual_nick] = socket_sid
                    # Remove old mapping
                    try:
                        del self.irc_connections[nickname]
                    except KeyError:
                        pass
                    try:
                        del self.clients[nickname]
                    except KeyError:
                        pass

                conn.join_channel(self.channel)
                return actual_nick
            return None
    
    def disconnect_user(self, nickname):
        """Disconnect a user from IRC"""
        with self.lock:
            if nickname in self.irc_connections:
                conn = self.irc_connections[nickname]
                conn.disconnect()
                del self.irc_connections[nickname]
            if nickname in self.clients:
                del self.clients[nickname]
    
    def send_message(self, nickname, message):
        """Send a message to IRC"""
        with self.lock:
            if nickname in self.irc_connections:
                conn = self.irc_connections[nickname]
                return conn.send_message(message)
        return False
    
    def broadcast_to_web(self, sender, message, timestamp=None):
        """Broadcast IRC message to all web clients"""
        # Dedupe: multiple IRC connections may receive same event
        now = time.time()
        key = f"{sender}\n{message}".strip()
        if key:
            last = self._recent.get(key)
            if last is not None and (now - last) < self._recent_ttl_sec:
                return
            self._recent[key] = now
            # Periodic cleanup (bounded memory)
            if len(self._recent) > self._recent_max:
                cutoff = now - self._recent_ttl_sec
                for k, ts in list(self._recent.items()):
                    if ts < cutoff:
                        self._recent.pop(k, None)
                # If still too big, drop oldest-ish entries
                if len(self._recent) > self._recent_max:
                    for k in list(self._recent.keys())[: max(0, len(self._recent) - self._recent_max)]:
                        self._recent.pop(k, None)

        if not timestamp:
            timestamp = datetime.now().isoformat()
        
        msg = {
            'sender': sender,
            'message': message,
            'timestamp': timestamp,
            'source': 'irc'
        }
        self.socketio.emit('irc_message', msg, namespace='/')


class IRCConnection:
    """Individual IRC connection for a user"""
    
    def __init__(self, nickname, server, port, channel, bridge):
        self.nickname = nickname
        self.original_nickname = nickname
        self.server = server
        self.port = port
        self.channel = channel
        self.bridge = bridge
        self.socket = None
        self.connected = False
        self.registered = False
        self._nick_attempts = 0
    
    def connect(self):
        """Connect to IRC server"""
        try:
            raw_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            raw_socket.settimeout(5)
            raw_socket.connect((self.server, self.port))
            
            context = ssl.create_default_context()
            self.socket = context.wrap_socket(raw_socket, server_hostname=self.server)
            self.connected = True
            
            self._send(f"NICK {self.nickname}")
            self._send(f"USER {self.nickname} 0 * :{self.nickname}")
            
            return True
        except Exception as e:
            print(f"IRC connection error for {self.nickname}: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from IRC"""
        self.connected = False
        if self.socket:
            try:
                self._send("QUIT :Goodbye")
                self.socket.close()
            except:
                pass
            self.socket = None
    
    def _send(self, message):
        """Send raw IRC message"""
        if self.socket and self.connected:
            try:
                self.socket.send(f"{message}\r\n".encode('utf-8', errors='ignore'))
                return True
            except:
                return False
        return False
    
    def send_message(self, message):
        """Send PRIVMSG to channel"""
        if self.channel:
            return self._send(f"PRIVMSG {self.channel} :{message}")
        return False
    
    def join_channel(self, channel):
        """Join IRC channel"""
        if not channel.startswith('#'):
            channel = '#' + channel
        self.channel = channel
        return self._send(f"JOIN {channel}")
    
    def receive_messages(self):
        """Receive and process IRC messages"""
        buffer = ""
        
        while self.connected:
            try:
                if not self.socket:
                    break
                
                self.socket.settimeout(1)
                data = self.socket.recv(4096)
                
                if not data:
                    break
                
                buffer += data.decode('utf-8', errors='ignore')
                
                while '\r\n' in buffer:
                    line, buffer = buffer.split('\r\n', 1)
                    if line:
                        self._handle_message(line)
            
            except socket.timeout:
                continue
            except Exception as e:
                if self.connected:
                    print(f"IRC receive error for {self.nickname}: {e}")
                break
        
        self.connected = False
    
    def _handle_message(self, line):
        """Handle incoming IRC message"""
        # Handle PING
        if line.startswith('PING'):
            pong_msg = line.replace('PING', 'PONG', 1)
            self._send(pong_msg)
            return
        
        # Parse message
        if line.startswith(':'):
            first_space = line.find(' ', 1)
            if first_space == -1:
                return
            
            prefix = line[1:first_space]
            rest = line[first_space + 1:]
            parts = rest.split(' ', 2)
            
            if len(parts) < 1:
                return
            
            command = parts[0]
            params = parts[1] if len(parts) > 1 else None
            
            # Find trailing (starts with :)
            trailing = None
            if len(parts) >= 3:
                if parts[2].startswith(':'):
                    trailing = parts[2][1:]
                else:
                    remaining = ' '.join(parts[2:])
                    if ' :' in remaining:
                        trailing = remaining.split(' :', 1)[1]
        else:
            return
        
        # Extract nickname from prefix
        nickname = None
        if prefix:
            nickname_match = re.match(r'^([^!]+)', prefix)
            if nickname_match:
                nickname = nickname_match.group(1)
        
        # Handle different commands
        if command == '001':  # Registration complete
            self.registered = True
            print(f"IRC: {self.nickname} registered")
        elif command == '433':  # Nickname in use
            self._nick_attempts += 1
            if self._nick_attempts < 5:
                new_nick = f"{self.original_nickname}_{self._nick_attempts}"
                self.nickname = new_nick
                self._send(f"NICK {new_nick}")
        elif command == 'PRIVMSG':
            # Channel message - broadcast to web
            if nickname and nickname.lower() != self.nickname.lower():
                message = trailing or ''
                self.bridge.broadcast_to_web(nickname, message)
        elif command == 'JOIN':
            if nickname:
                system_msg = f"*** {nickname} joined"
                self.bridge.broadcast_to_web('[System]', system_msg)
        elif command == 'PART':
            if nickname:
                system_msg = f"*** {nickname} left"
                self.bridge.broadcast_to_web('[System]', system_msg)
        elif command == 'QUIT':
            if nickname:
                system_msg = f"*** {nickname} quit"
                self.bridge.broadcast_to_web('[System]', system_msg)
