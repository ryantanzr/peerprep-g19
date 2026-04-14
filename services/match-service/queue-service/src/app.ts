import express from 'express';
import cors from 'cors';
import queueRouter from './routes/queue';
import { initBroadcaster } from './services/broadcaster';

const app = express();
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type']
}));
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/queue', queueRouter);

initBroadcaster().catch(console.error);

export default app;