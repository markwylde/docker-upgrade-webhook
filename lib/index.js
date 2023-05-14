import createServer from "./createServer.js";

const server = createServer(null, process.env.DEBOUNCE || '0,10000');
server.listen(1907);
console.log('listening on', 1907);
