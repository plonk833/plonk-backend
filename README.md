# Plonk Backend

A real-time monitoring system for detecting suspicious activity on Pump.fun, a Solana-based token creation platform.

## Overview

This service monitors Solana blockchain transactions related to Pump.fun to detect potentially suspicious token creation and trading activity. It identifies three main patterns:

1. **Fresh Wallets** - New wallets with no transaction history suddenly buying tokens
2. **Dormant Wallets** - Previously inactive wallets (60+ days dormant) suddenly becoming active
3. **Bundled Token Purchases** - Multiple purchases of a newly created token in rapid succession

The system uses WebSockets to provide real-time alerts and maintains a history of recent events.

## Features

- Real-time transaction monitoring via Helius WebSocket API
- Detection of suspicious wallet behavior
- Identification of potentially coordinated token launches
- WebSocket server for real-time client notifications
- Efficient transaction processing with batched queue system

## Prerequisites

- Node.js (v14+)
- npm or yarn
- Helius API key with WebSocket access

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/plonk833/plonk-backend
   cd plonk-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root:
   ```
   PORT=3000
   HELIUS_API_KEY=your_helius_api_key_here
   ```

## Usage

Start the monitoring service:

```bash
npm start
```

Connect to the WebSocket server to receive real-time alerts:

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  console.log('Connected to Pump Monitor');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received event:', data);
};
```

## Event Types

The WebSocket server emits the following event types:

1. **fresh_wallet** - A newly created wallet making token purchases
   ```json
   {
     "type": "fresh_wallet",
     "data": {
       "signature": "transaction_signature",
       "address": "wallet_address",
       "timestamp": "2025-05-12T12:00:00.000Z",
       "tokenAddress": "token_mint_address"
     }
   }
   ```

2. **dormant_wallet** - A previously inactive wallet (60+ days) becoming active
   ```json
   {
     "type": "dormant_wallet",
     "data": {
       "signature": "transaction_signature",
       "address": "wallet_address",
       "timestamp": "2025-05-12T12:00:00.000Z",
       "tokenAddress": "token_mint_address"
     }
   }
   ```

3. **bundled_token** - Multiple rapid purchases of a newly created token
   ```json
   {
     "type": "bundled_token",
     "data": {
       "signature": "transaction_signature",
       "tokenAddress": "token_mint_address",
       "buyCount": 4,
       "timestamp": "2025-05-12T12:00:00.000Z"
     }
   }
   ```

## Implementation Details

- Uses Helius RPC to monitor Solana blockchain transactions
- Filters transactions related to Pump.fun token creation and purchases
- Processes transactions in batches to avoid rate limiting
- Detects suspicious patterns in wallet behavior and token activity

## License

MIT

## Acknowledgments

- [Solana Web3.js](https://github.com/solana-labs/solana-web3.js)
- [Helius API](https://helius.xyz/)
- [ws (WebSocket library)](https://github.com/websockets/ws)