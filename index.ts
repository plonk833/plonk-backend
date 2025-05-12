import WebSocket, { WebSocketServer } from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import { setIntervalAsync } from 'set-interval-async';
import config from './config';

const server = new WebSocketServer({
	port: Number(config.PORT),
});

server.on('connection', function connection(ws) {
	ws.on('error', console.error);
	ws.send(JSON.stringify({ type: 'connect', data: events }));
});

const events: any = {
	fresh_wallet: [],
	dormant_wallet: [],
	bundled_token: [],
};

function addEvent(type: string, data: any): void {
	events[type].unshift(data);
	if (events[type].length > 10) {
		events[type].pop();
	}

	server.clients.forEach(function each(client) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(JSON.stringify({ data, type }));
		}
	});
}

class PumpMonitor {
	private ws: WebSocket;
	private connection: Connection;
	private processedWallets = new Set<string>();
	private txQueue: Array<{
		signature: string;
		buyerAddress: string;
		tokenAddress: string;
	}> = [];
	private tokenCreationSlots = new Map<string, string>();
	private tokenBuyCount = new Map<string, number>();

	constructor() {
		this.ws = new WebSocket(`wss://atlas-mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`);
		this.connection = new Connection('https://rpc.helius.xyz/?api-key=' + config.HELIUS_API_KEY);
		this.setupWebSocket();
		setIntervalAsync(async () => {
			await this.processQueueBatch();
		}, 1000);
	}

	private async processQueueBatch() {
		if (this.txQueue.length === 0) return;

		const batch = this.txQueue.splice(0, 50);
		await Promise.all(batch.map((tx) => this.processTransaction(tx)));

		console.log(`Queue size: ${this.txQueue.length}`);
	}

	private async processTransaction(tx: { signature: string; buyerAddress: string; tokenAddress: string }) {
		const [isFresh, isDormant] = await Promise.all([
			this.checkFreshWallet(tx.buyerAddress),
			this.checkDormantWallet(tx.buyerAddress),
		]);

		if (isFresh) {
			console.log('⚠️ WARNING: Fresh wallet detected:', tx.buyerAddress);
			addEvent('fresh_wallet', {
				signature: tx.signature,
				address: tx.buyerAddress,
				timestamp: new Date().toISOString(),
				tokenAddress: tx.tokenAddress,
			});
		}

		if (isDormant) {
			console.log('⚠️ WARNING: Dormant wallet detected:', tx.buyerAddress);
			addEvent('dormant_wallet', {
				signature: tx.signature,
				address: tx.buyerAddress,
				timestamp: new Date().toISOString(),
				tokenAddress: tx.tokenAddress,
			});
		}
	}

	private setupWebSocket() {
		this.ws = new WebSocket(`wss://atlas-mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`);
		this.ws.on('open', () => {
			console.log('WebSocket connection established');
			const subscribeMessage = {
				jsonrpc: '2.0',
				id: 1,
				method: 'transactionSubscribe',
				params: [
					{ failed: false, accountInclude: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'] },
					{
						commitment: 'confirmed',
						encoding: 'jsonParsed',
						transactionDetails: 'full',
						maxSupportedTransactionVersion: 0,
					},
				],
			};
			this.ws.send(JSON.stringify(subscribeMessage));
		});

		this.ws.on('message', async (data: WebSocket.Data) => {
			const messageStr = data.toString('utf8');
			try {
				const messageObj = JSON.parse(messageStr);
				if (!messageObj.params) return;

				const result = messageObj.params.result;
				const logs = result.transaction.meta.logMessages as string[];
				const signature = result.signature;
				const accountKeys = result.transaction.transaction.message.accountKeys;
				const slot = result.slot.toString();

				if (logs.some((log) => log.includes('Program log: Instruction: InitializeMint2'))) {
					const tokenAddress = accountKeys[1].pubkey;
					this.tokenCreationSlots.set(tokenAddress, slot);
					this.tokenBuyCount.set(tokenAddress, 0);
				}

				if (logs && logs.some((log) => log.includes('Program log: Instruction: Buy'))) {
					//console.log('TXN:', signature);

					// Find which token was transferred from the pool
					const postTokenBalances = result.transaction.meta.postTokenBalances;
					const preTokenBalances = result.transaction.meta.preTokenBalances;

					// Find the transfer where the pool's balance decreased
					const poolTransfer = preTokenBalances?.find((balance: any) => {
						const postBalance = postTokenBalances?.find(
							(post: any) => post.accountIndex === balance.accountIndex
						);
						return postBalance && postBalance.uiTokenAmount.amount < balance.uiTokenAmount.amount;
					});

					if (poolTransfer) {
						const tokenMint = poolTransfer.mint;

						const buyerAddress = this.findBuyerAddress(accountKeys, logs);
						if (buyerAddress && !this.processedWallets.has(buyerAddress)) {
							this.processedWallets.add(buyerAddress);
							this.txQueue.push({
								signature,
								buyerAddress,
								tokenAddress: tokenMint,
							});
							//console.log(`Added to queue. Current size: ${this.txQueue.length}`);
						}

						if (this.tokenCreationSlots.get(tokenMint) === slot) {
							const currentCount = (this.tokenBuyCount.get(tokenMint) || 0) + 1;
							this.tokenBuyCount.set(tokenMint, currentCount);

							if (currentCount > 3) {
								console.log('🚨 BUNDLED TOKEN DETECTED 🚨');
								console.log('Token:', tokenMint);
								addEvent('bundled_token', {
									signature: signature,
									buyCount: currentCount,
									timestamp: new Date().toISOString(),
									tokenAddress: tokenMint,
								});
							}
						}
					}
				}
			} catch (e) {
				console.error(e);
			}
		});

		this.ws.on('error', (error) => {
			console.error('WebSocket error:', error);
		});

		this.ws.on('close', () => {
			console.log('WebSocket connection closed');
			setTimeout(() => this.setupWebSocket(), 5000);
		});
	}

	private findBuyerAddress(accountKeys: any[], logs: string[]): string | null {
		// First try to find from logs
		const userLog = logs.find((log) => log.includes('Program log: User:'));
		if (userLog) {
			return userLog.split('User:')[1].trim();
		}

		// Fallback to account keys analysis
		return accountKeys.find((ak: any) => ak.signer && ak.writable)?.pubkey || null;
	}

	private async checkFreshWallet(address: string): Promise<boolean> {
		try {
			const pubkey = new PublicKey(address);
			const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit: 4 }, 'confirmed');

			// Check if wallet has less than 3 transactions
			if (signatures.length <= 3) {
				// Get the first transaction to check initial balance
				const firstTx = await this.connection.getTransaction(signatures[signatures.length - 1].signature, {
					maxSupportedTransactionVersion: 0,
				});

				if (firstTx && firstTx.meta) {
					const accountIndex = firstTx.transaction.message.staticAccountKeys.findIndex(
						(key) => key.toString() === address
					);

					// Check if preBalance was 0
					return firstTx.meta.preBalances[accountIndex] === 0;
				}
			}
			return false;
		} catch (error) {
			console.error('Error checking fresh wallet:', error);
			return false;
		}
	}

	private async checkDormantWallet(address: string): Promise<boolean> {
		try {
			const pubkey = new PublicKey(address);
			// Get the last 2 transactions (current and previous)
			const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit: 2 }, 'confirmed');

			if (signatures.length < 2) return false;

			const previousTxTime = signatures[1].blockTime;
			if (!previousTxTime) return false;

			const currentTime = Math.floor(Date.now() / 1000);
			const sixMonthsInSeconds = 60 * 24 * 60 * 60; // 60 days

			return currentTime - previousTxTime > sixMonthsInSeconds;
		} catch (error) {
			console.error('Error checking dormant wallet:', error);
			return false;
		}
	}

	public start() {
		console.log('Starting Pump.fun transaction monitor...');
	}

	public stop() {
		if (this.ws) {
			this.ws.close();
		}
	}
}

const monitor = new PumpMonitor();
monitor.start();

process.on('SIGINT', () => {
	monitor.stop();
	server.close();
	process.exit(0);
});
