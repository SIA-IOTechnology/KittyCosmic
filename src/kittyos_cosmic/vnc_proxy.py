#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
VNC WebSocket Proxy for KittyOS
Converts WebSocket connections to VNC TCP connections
"""

import socket
import threading
import struct
import select
import time
from typing import Optional, Dict
from core.output_handler import print_info, print_error, print_success, print_warning

class VNCProxy:
    """WebSocket to VNC TCP proxy"""
    
    def __init__(self):
        self.connections: Dict[str, 'VNCConnection'] = {}
        self.lock = threading.Lock()
    
    def create_connection(self, connection_id: str, vnc_host: str, vnc_port: int, password: str = None) -> bool:
        """Create a new VNC connection"""
        try:
            with self.lock:
                if connection_id in self.connections:
                    self.connections[connection_id].close()
                
                conn = VNCConnection(connection_id, vnc_host, vnc_port, password)
                if conn.connect():
                    self.connections[connection_id] = conn
                    print_success(f"VNC connection established: {vnc_host}:{vnc_port}")
                    return True
                else:
                    print_error(f"Failed to connect to VNC server: {vnc_host}:{vnc_port}")
                    return False
        except Exception as e:
            print_error(f"Error creating VNC connection: {e}")
            return False
    
    def send_data(self, connection_id: str, data: bytes) -> bool:
        """Send data to VNC server"""
        with self.lock:
            conn = self.connections.get(connection_id)
            if conn:
                return conn.send(data)
            return False
    
    def receive_data(self, connection_id: str) -> Optional[bytes]:
        """Receive data from VNC server"""
        with self.lock:
            conn = self.connections.get(connection_id)
            if conn:
                return conn.receive()
            return None
    
    def close_connection(self, connection_id: str):
        """Close a VNC connection"""
        with self.lock:
            conn = self.connections.pop(connection_id, None)
            if conn:
                conn.close()
                print_info(f"VNC connection closed: {connection_id}")
    
    def is_connected(self, connection_id: str) -> bool:
        """Check if connection is active"""
        with self.lock:
            conn = self.connections.get(connection_id)
            return conn is not None and conn.is_connected()
    
    def get_server_init_data(self, connection_id: str) -> Optional[bytes]:
        """Get ServerInit data for a connection (if available)"""
        with self.lock:
            conn = self.connections.get(connection_id)
            if conn and hasattr(conn, 'server_init_data') and conn.server_init_data:
                data = conn.server_init_data
                conn.server_init_data = None  # Clear after reading
                return data
            return None


class VNCConnection:
    """Single VNC TCP connection"""
    
    def __init__(self, connection_id: str, vnc_host: str, vnc_port: int, password: str = None):
        self.connection_id = connection_id
        self.vnc_host = vnc_host
        self.vnc_port = vnc_port
        self.password = password
        self.sock: Optional[socket.socket] = None
        self.connected = False
        self.lock = threading.Lock()
    
    def _recv_exact(self, size: int, timeout: float = 10.0) -> bytes:
        """Receive exactly 'size' bytes, with timeout"""
        data = b''
        original_timeout = self.sock.gettimeout()
        self.sock.settimeout(timeout)
        try:
            while len(data) < size:
                chunk = self.sock.recv(size - len(data))
                if not chunk:
                    raise socket.error("Connection closed")
                data += chunk
                # Debug: log first chunk received
                if len(data) == len(chunk) and len(data) <= 4:
                    print_info(f"_recv_exact: received {len(chunk)} bytes: {chunk.hex()}")
            return data
        except socket.timeout:
            print_error(f"_recv_exact: timeout after {timeout}s, received {len(data)}/{size} bytes")
            raise
        finally:
            self.sock.settimeout(original_timeout)
    
    def connect(self) -> bool:
        """Connect to VNC server"""
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(30)  # Longer timeout for connection
            self.sock.connect((self.vnc_host, self.vnc_port))
            self.connected = True
            
            # Read VNC handshake version (12 bytes)
            version = self._recv_exact(12, timeout=10.0)
            if not version.startswith(b'RFB'):
                print_error(f"Invalid VNC handshake: {version}")
                self.close()
                return False
            
            # Send our version
            self.sock.sendall(b'RFB 003.008\n')
            
            # Read security types (1 byte for count)
            num_types_data = self._recv_exact(1, timeout=10.0)
            num_types = struct.unpack('!B', num_types_data)[0]
            
            if num_types == 0:
                # Security handshake failed
                reason_len_data = self._recv_exact(4, timeout=10.0)
                reason_len = struct.unpack('!I', reason_len_data)[0]
                reason = self._recv_exact(reason_len, timeout=10.0).decode('utf-8', errors='ignore')
                print_error(f"VNC security handshake failed: {reason}")
                self.close()
                return False
            
            security_types = self._recv_exact(num_types, timeout=10.0)
            
            # Use VNC authentication (type 2) if available, otherwise None (type 1)
            if 2 in security_types:
                # VNC authentication
                self.sock.sendall(struct.pack('!B', 2))
                
                # Receive challenge (16 bytes)
                challenge = self._recv_exact(16, timeout=10.0)
                
                # Send password response (simple DES encryption)
                if self.password:
                    response = self._encrypt_password(challenge, self.password)
                else:
                    response = b'\x00' * 16
                
                self.sock.sendall(response)
                
                # Read security result (4 bytes)
                result_data = self._recv_exact(4, timeout=10.0)
                result = struct.unpack('!I', result_data)[0]
                if result != 0:
                    reason_len_data = self._recv_exact(4, timeout=10.0)
                    reason_len = struct.unpack('!I', reason_len_data)[0]
                    reason = self._recv_exact(reason_len, timeout=10.0).decode('utf-8', errors='ignore')
                    print_error(f"VNC authentication failed: {reason}")
                    self.close()
                    return False
            elif 1 in security_types:
                # None authentication
                self.sock.sendall(struct.pack('!B', 1))
                
                # Per RFB 3.8 spec, server sends a SecurityResult even for None auth
                try:
                    security_result = self._recv_exact(4, timeout=10.0)
                    status = struct.unpack('!I', security_result)[0]
                    if status != 0:
                        reason_len_data = self._recv_exact(4, timeout=10.0)
                        reason_len = struct.unpack('!I', reason_len_data)[0]
                        reason = self._recv_exact(reason_len, timeout=10.0).decode('utf-8', errors='ignore')
                        print_error(f"VNC security (None) failed: {reason}")
                        self.close()
                        return False
                except socket.timeout:
                    print_warning("Timeout waiting for SecurityResult after None auth; proceeding anyway")
            else:
                print_error(f"No supported VNC security type. Available: {list(security_types)}")
                self.close()
                return False
            
            # Client initialization
            self.sock.sendall(struct.pack('!B', 1))  # Share desktop
            print_info("ClientInit sent (shared-flag=1)")
            
            # Server initialization - read all data and store it
            # ServerInit format: framebuffer width (2), height (2), pixel format (16), name length (4), name (variable)
            # Read immediately - server should send ServerInit right after ClientInit
            print_info("Waiting for ServerInit...")
            server_init = self._recv_exact(4, timeout=10.0)  # width + height
            print_info(f"ServerInit first 4 bytes (raw): {server_init.hex()}, as ints: {[b for b in server_init]}")
            
            # Read pixel format (16 bytes)
            pixel_format = self._recv_exact(16, timeout=10.0)
            
            # Read name length (4 bytes)
            name_len_bytes = self._recv_exact(4, timeout=10.0)
            name_len = struct.unpack('!I', name_len_bytes)[0]
            
            # Read server name
            server_name_bytes = self._recv_exact(name_len, timeout=10.0)
            
            server_name = server_name_bytes.decode('utf-8', errors='ignore')
            width = struct.unpack('!H', server_init[0:2])[0]
            height = struct.unpack('!H', server_init[2:4])[0]
            
            # Debug: print raw bytes
            print_info(f"ServerInit complete data (hex, first 50): {(server_init + pixel_format + name_len_bytes + server_name_bytes)[:50].hex()}")
            print_info(f"Width: {width}, Height: {height}, Server name: '{server_name}' (len={len(server_name_bytes)})")
            print_info(f"Pixel format: bitsPerPixel={pixel_format[0]}, depth={pixel_format[1]}, bigEndian={pixel_format[2]}")
            
            if width == 0 or height == 0:
                print_error(f"Invalid screen dimensions: {width}x{height}. ServerInit may be corrupted.")
                print_error(f"Full ServerInit data (hex): {(server_init + pixel_format + name_len_bytes + server_name_bytes).hex()}")
                # Try to read more data to see if ServerInit is delayed
                try:
                    extra_data = self.sock.recv(1024)
                    if extra_data:
                        print_info(f"Extra data received after ServerInit: {extra_data[:50].hex()}")
                except:
                    pass
            
            print_info(f"Connected to VNC server: {server_name} ({width}x{height})")
            
            # Store ServerInit data for first transmission (complete message)
            self.server_init_data = server_init + pixel_format + name_len_bytes + server_name_bytes
            print_info(f"ServerInit data length: {len(self.server_init_data)} bytes")
            
            # Set non-blocking timeout for receive operations after handshake
            self.sock.settimeout(0.1)
            
            return True
            
        except Exception as e:
            print_error(f"VNC connection error: {e}")
            self.close()
            return False
    
    def _encrypt_password(self, challenge: bytes, password: str) -> bytes:
        """Simple VNC password encryption (DES)"""
        try:
            from Crypto.Cipher import DES
            # Pad password to 8 bytes
            pwd_bytes = password[:8].encode('utf-8').ljust(8, b'\x00')
            # Reverse bits in each byte (VNC quirk)
            pwd_bytes = bytes([int('{:08b}'.format(b)[::-1], 2) for b in pwd_bytes])
            cipher = DES.new(pwd_bytes, DES.MODE_ECB)
            return cipher.encrypt(challenge)
        except ImportError:
            # Fallback: return zeros if pycryptodome not available
            print_warning("pycryptodome not available, VNC password auth may fail")
            return b'\x00' * 16
        except Exception as e:
            print_error(f"Password encryption error: {e}")
            return b'\x00' * 16
    
    def send(self, data: bytes) -> bool:
        """Send data to VNC server"""
        if not self.connected or not self.sock:
            return False
        try:
            with self.lock:
                self.sock.sendall(data)
            return True
        except Exception as e:
            print_error(f"VNC send error: {e}")
            self.close()
            return False
    
    def receive(self) -> Optional[bytes]:
        """Receive data from VNC server (non-blocking)"""
        if not self.connected or not self.sock:
            return None
        try:
            with self.lock:
                # If we have ServerInit data, send it first
                if self.server_init_data:
                    data = self.server_init_data
                    self.server_init_data = None
                    return data
                
                ready = select.select([self.sock], [], [], 0.1)
                if ready[0]:
                    data = self.sock.recv(8192)
                    if not data:
                        self.close()
                        return None
                    return data
            return None
        except Exception as e:
            print_error(f"VNC receive error: {e}")
            self.close()
            return None
    
    def is_connected(self) -> bool:
        """Check if connection is active"""
        return self.connected and self.sock is not None
    
    def close(self):
        """Close the connection"""
        self.connected = False
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
            self.sock = None


# Global VNC proxy instance
vnc_proxy = VNCProxy()
