import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Supabase configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://evybpccbfjxzvqfqukop.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eWJwY2NiZmp4enZxZnF1a29wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMTA1MTcsImV4cCI6MjA4MTU4NjUxN30.8qFbXe8Mh_eVsUpfzNihYuH1kbJBI5kldf7uAzqMzjM';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Connection retry configuration
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 5000;

// Calculate exponential backoff with jitter
function getRetryDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, attempt),
    MAX_RETRY_DELAY_MS
  );
  const jitter = Math.random() * exponentialDelay * 0.5;
  return Math.floor(exponentialDelay + jitter);
}

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Create client for public/anon access (read operations)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    headers: {
      'x-application-name': 'webflow-gallery',
    },
  },
});

// Create admin client for service role operations (write operations during scraping)
export const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : supabase; // Fallback to anon if no service key

// Connection status tracking
interface ConnectionStatus {
  isConnected: boolean;
  lastChecked: Date | null;
  lastError: string | null;
  latencyMs: number | null;
}

let connectionStatus: ConnectionStatus = {
  isConnected: false,
  lastChecked: null,
  lastError: null,
  latencyMs: null,
};

// Check Supabase connection
export async function checkConnection(): Promise<ConnectionStatus> {
  const startTime = Date.now();
  try {
    const { error } = await supabase.from('templates').select('id').limit(1);

    connectionStatus = {
      isConnected: !error,
      lastChecked: new Date(),
      lastError: error?.message || null,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    connectionStatus = {
      isConnected: false,
      lastChecked: new Date(),
      lastError: err instanceof Error ? err.message : 'Unknown error',
      latencyMs: Date.now() - startTime,
    };
  }

  return connectionStatus;
}

// Get cached connection status
export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus;
}

// Connection queue for resilient operations during scraping
interface QueuedOperation<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  retries: number;
  maxRetries: number;
}

class ConnectionQueue {
  private queue: QueuedOperation<unknown>[] = [];
  private isProcessing = false;
  private isPaused = false;

  async enqueue<T>(
    operation: () => Promise<T>,
    maxRetries: number = MAX_RETRIES
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        operation: operation as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        retries: 0,
        maxRetries,
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isPaused || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && !this.isPaused) {
      const item = this.queue[0];

      try {
        const result = await item.operation();
        item.resolve(result);
        this.queue.shift();
      } catch (error) {
        item.retries++;

        if (item.retries >= item.maxRetries) {
          item.reject(error as Error);
          this.queue.shift();
        } else {
          // Exponential backoff before retry
          const delay = getRetryDelay(item.retries);
          console.warn(`[Supabase] Retrying operation (${item.retries}/${item.maxRetries}) after ${delay}ms`);
          await sleep(delay);

          // Check connection before retry
          const status = await checkConnection();
          if (!status.isConnected) {
            console.warn('[Supabase] Connection lost, pausing queue...');
            this.pause();
            // Wait for reconnection
            await this.waitForReconnection();
            this.resume();
          }
        }
      }
    }

    this.isProcessing = false;
  }

  private async waitForReconnection(maxWaitMs: number = 60000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const status = await checkConnection();
      if (status.isConnected) {
        console.log('[Supabase] Reconnected successfully');
        return;
      }
      await sleep(2000);
    }

    throw new Error('Failed to reconnect to Supabase after timeout');
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
    this.processQueue();
  }

  clear(): void {
    for (const item of this.queue) {
      item.reject(new Error('Queue cleared'));
    }
    this.queue = [];
  }

  get length(): number {
    return this.queue.length;
  }

  get paused(): boolean {
    return this.isPaused;
  }
}

// Export singleton connection queue
export const connectionQueue = new ConnectionQueue();

// Execute operation with retry logic (standalone, not queued)
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  context: string = 'unknown',
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries - 1) {
        const delay = getRetryDelay(attempt);
        if (attempt > 1) {
          console.warn(`[Supabase] Retry ${attempt + 1}/${maxRetries} after ${delay}ms for: ${context}`);
        }
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// Log activity to supabase_activity_log
export async function logActivity(
  actionType: string,
  tableName: string,
  recordCount: number = 1,
  details?: Record<string, unknown>,
  success: boolean = true,
  errorMessage?: string,
  durationMs?: number
): Promise<void> {
  try {
    await supabase.from('supabase_activity_log').insert({
      action_type: actionType,
      table_name: tableName,
      record_count: recordCount,
      details: details || null,
      success,
      error_message: errorMessage || null,
      duration_ms: durationMs || null,
    });
  } catch (err) {
    // Don't throw - logging failures shouldn't break operations
    console.error('[Supabase] Failed to log activity:', err);
  }
}

// Get Supabase configuration for client
export function getSupabaseConfig() {
  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    hasServiceKey: !!SUPABASE_SERVICE_KEY,
  };
}

// Export types
export type { SupabaseClient, Database };
