const WebSocket = require('ws');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: port });

console.log(`Universal Blox Server started on port ${port}`);

// --- UNIVERSAL STATE ---
// We store everything in one big map: ID -> Data
let gameEntities = {}; 

// Heartbeat to keep connections alive on free tier
const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    // Track which entities (IDs) belong to this connection
    // So we can delete them when this specific user disconnects
    ws.ownedIds = new Set();

    console.log("Client connected");

    // 1. Send Full State on Join
    ws.send(JSON.stringify({
        type: 'INIT',
        state: gameEntities
    }));

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);

            // --- UNIVERSAL PROTOCOL ---
            // { type: 'SET' | 'DELETE', id: '...', data: { ... } }

            if (msg.type === 'SET') {
                // 1. Save to Server Memory
                gameEntities[msg.id] = msg.data;
                
                // 2. Mark as owned by this connection (for auto-cleanup)
                // Only mark if it's a player or avatar part (transient)
                // World blocks should persist even if creator leaves? 
                // For now, let's make everything persistent EXCEPT players.
                if (msg.data && (msg.data.kind === 'player' || msg.data.kind === 'avatar-part')) {
                    ws.ownedIds.add(msg.id);
                }

                // 3. Broadcast to everyone
                broadcast(msg, ws);
            }
            else if (msg.type === 'DELETE') {
                // 1. Remove from Memory
                delete gameEntities[msg.id];
                if (ws.ownedIds.has(msg.id)) ws.ownedIds.delete(msg.id);

                // 2. Broadcast
                broadcast(msg, ws);
            }

        } catch (e) {
            console.error("Error:", e);
        }
    });

    ws.on('close', () => {
        console.log("Client disconnected, cleaning up...");
        
        // Auto-delete everything this user "owned" (Player, Avatar parts)
        ws.ownedIds.forEach(id => {
            if (gameEntities[id]) {
                delete gameEntities[id];
                // Tell everyone to remove it
                broadcast({ type: 'DELETE', id: id });
            }
        });
        ws.ownedIds.clear();
    });
});

function broadcast(data, senderWs) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            client.send(msg);
        }
    });
}

wss.on('close', () => clearInterval(interval));
