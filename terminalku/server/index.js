// Entry point Fastify: static, cookie, websocket, auth middleware, routes.
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'node:path';
import { config } from './config.js';
import { getUserFromToken } from './auth.js';
import { authRoutes } from './routes-auth.js';
import { fsRoutes } from './routes-fs.js';
import { terminalWs } from './routes-terminal.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(fastifyCookie);
await app.register(fastifyWebsocket);
await app.register(fastifyStatic, { root: path.join(config.root, 'public') });

// Auth middleware: isi req.user dari cookie untuk semua /api/*
app.addHook('onRequest', async (req) => {
  if (req.url.startsWith('/api/')) {
    const token = req.cookies?.terminalku_session;
    req.user = getUserFromToken(token);
  }
});

// Proteksi: semua /api/* (kecuali login & me) butuh login
app.addHook('preHandler', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return;
  if (req.url.startsWith('/api/auth/login')) return;
  if (req.url.startsWith('/api/me')) return;
  if (!req.user) return reply.code(401).send({ error: 'belum login' });
});

authRoutes(app);
fsRoutes(app);
terminalWs(app);

// Fallback SPA: semua route non-API → index.html
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
  return reply.sendFile('index.html');
});

await app.listen({ port: config.port, host: config.host });
console.log(`[terminalku] berjalan di http://${config.host}:${config.port}`);