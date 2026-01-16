import express from 'express';
// @ts-ignore
import {PORT} from './config/env.js';
const app = express();

app.get('/', (req, res) => {
  res.send('Welcomr to a Smart Triage System!');
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
})
