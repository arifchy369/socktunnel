# 🌐 SockTunnel

**SockTunnel** is a lightweight reverse tunneling solution that securely exposes a local HTTP or WebSocket server to the internet using a persistent WebSocket-based control channel. Ideal for remote access, testing, or stealth operations.

## 🔧 Features

- Full HTTP/1.1 reverse proxy with streaming
- Native WebSocket support (bidirectional)
- Encrypted WebSocket tunnel with authentication
- Chunked transfer handling for large payloads
- Single-line setup on client and server

---

## 🧱 Architecture

```

\[Local HTTP/WebSocket Service]
↑
\[tunnel.py] 🔐
↑
WebSocket (WSS)
↓
\[app.js Server] 🌍
↓
Public Internet

````

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/arifchy369/socktunnel.git
cd socktunnel
````

### 2. Install Server Dependencies

```bash
npm install
```

### 3. Install Client Dependencies

```bash
pip install -r requirements.txt
```

---

## ⚙️ Configuration

Edit `config.json` in both client and server:

```json
{
  "host": "http://localhost:8080",  // local service
  "tunnel": "yourdomain.com",       // public server domain
  "token": "YOUR_SECRET_TOKEN"
}
```

---

## 🖥️ Running

### Start the Tunnel Server (Public Side)

```bash
npm start
```

### Start the Tunnel Client (Local Side)

```bash
python tunnel.py
```

---

## ✅ Status

* [x] HTTP proxying
* [x] WebSocket proxying
* [x] Token-based authentication
* [x] Binary streaming
---

## 📄 License

MIT License © 2025 Arif Chowdhury

