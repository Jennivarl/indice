// Starts Índice: the web dashboard + paid API, the Telegram bot, and a payout loop.
import { startServer } from './server.js';
import { startBot, runPayouts } from './bot.js';

startServer();
setInterval(runPayouts, 60_000); // retry any confirmed-but-unpaid reports every minute
startBot();
