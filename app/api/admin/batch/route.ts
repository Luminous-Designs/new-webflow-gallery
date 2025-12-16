import { NextRequest, NextResponse } from 'next/server';
import { BatchScraper, TemplatePhaseEvent, BatchProgressEvent, PerformanceConfig, ConfigChangeEvent } from '@/lib/scraper/batch-scraper';
import {
  getSession,
  getSessionProgress,
  getInterruptedSession,
  getResumableSessions,
  ScrapeSessionType
} from '@/lib/db';

// Store active batch scraper instance
let activeBatchScraper: BatchScraper | null = null;
let currentSessionId: number | null = null;

// Store real-time events for polling
const sessionEvents: Map<number, {
  progress: BatchProgressEvent | null;
  templatePhases: Map<number, TemplatePhaseEvent>;
  logs: Array<{ timestamp: string; message: string }>;
}> = new Map();

function ensureSessionEvents(sessionId: number) {
  if (!sessionEvents.has(sessionId)) {
    sessionEvents.set(sessionId, {
      progress: null,
      templatePhases: new Map(),
      logs: []
    });
  }
  return sessionEvents.get(sessionId)!;
}

export async function POST(request: NextRequest) {
  // Check admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      action,
      urls,
      sessionType = 'update',
      batchSize = 10,
      concurrency = 5,
      browserInstances = 1,
      pagesPerBrowser = 5
    } = body;

    switch (action) {
      case 'start': {
        if (activeBatchScraper) {
          return NextResponse.json(
            { error: 'A batch scrape is already in progress' },
            { status: 400 }
          );
        }

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return NextResponse.json(
            { error: 'URLs array required' },
            { status: 400 }
          );
        }

        // Create and initialize scraper
        activeBatchScraper = new BatchScraper({
          concurrency,
          browserInstances,
          pagesPerBrowser,
          batchSize
        });

        // Setup event listeners
        activeBatchScraper.on('session-started', (data) => {
          currentSessionId = data.sessionId;
          const events = ensureSessionEvents(data.sessionId);
          events.logs.push({
            timestamp: new Date().toISOString(),
            message: `Session started: ${data.totalTemplates} templates in ${data.totalBatches} batches`
          });
        });

        activeBatchScraper.on('batch-started', (data) => {
          const events = ensureSessionEvents(data.sessionId);
          events.logs.push({
            timestamp: new Date().toISOString(),
            message: `Batch ${data.batchNumber} started: ${data.totalTemplates} templates`
          });
        });

        activeBatchScraper.on('batch-completed', (data) => {
          const events = ensureSessionEvents(data.sessionId);
          events.logs.push({
            timestamp: new Date().toISOString(),
            message: `Batch ${data.batchNumber} completed`
          });
        });

        activeBatchScraper.on('template-phase-change', (data: TemplatePhaseEvent) => {
          const events = ensureSessionEvents(data.sessionId);
          events.templatePhases.set(data.templateId, data);
        });

        activeBatchScraper.on('template-completed', (data) => {
          const events = ensureSessionEvents(data.sessionId);
          events.templatePhases.delete(data.templateId);
          events.logs.push({
            timestamp: new Date().toISOString(),
            message: `Completed: ${data.templateName || data.templateUrl}`
          });
        });

        activeBatchScraper.on('template-failed', (data) => {
          const events = ensureSessionEvents(data.sessionId);
          events.templatePhases.delete(data.templateId);
          events.logs.push({
            timestamp: new Date().toISOString(),
            message: `Failed: ${data.templateUrl} - ${data.error}`
          });
        });

        activeBatchScraper.on('template-skipped', (data) => {
          const events = ensureSessionEvents(data.sessionId);
          events.templatePhases.delete(data.templateId);
          events.logs.push({
            timestamp: new Date().toISOString(),
            message: `Skipped: ${data.templateUrl}`
          });
        });

        activeBatchScraper.on('session-completed', async () => {
          if (activeBatchScraper) {
            await activeBatchScraper.close();
            activeBatchScraper = null;
          }
        });

        activeBatchScraper.on('session-cancelled', async () => {
          if (activeBatchScraper) {
            await activeBatchScraper.close();
            activeBatchScraper = null;
          }
        });

        activeBatchScraper.on('log', (data) => {
          if (currentSessionId) {
            const events = ensureSessionEvents(currentSessionId);
            events.logs.push({
              timestamp: new Date().toISOString(),
              message: data.message
            });
          }
        });

        activeBatchScraper.on('config-pending', (data: ConfigChangeEvent) => {
          if (currentSessionId) {
            const events = ensureSessionEvents(currentSessionId);
            events.logs.push({
              timestamp: new Date().toISOString(),
              message: `Config scheduled for next batch: concurrency=${data.pending?.concurrency}, browsers=${data.pending?.browserInstances}`
            });
          }
        });

        activeBatchScraper.on('config-applied', (data: ConfigChangeEvent) => {
          if (currentSessionId) {
            const events = ensureSessionEvents(currentSessionId);
            events.logs.push({
              timestamp: new Date().toISOString(),
              message: `Config applied: concurrency=${data.current.concurrency}, browsers=${data.current.browserInstances}, batch=${data.current.batchSize}`
            });
          }
        });

        // Initialize and start
        await activeBatchScraper.init();
        const session = await activeBatchScraper.startBatchedScrape(
          sessionType as ScrapeSessionType,
          urls
        );

        return NextResponse.json({
          message: 'Batch scrape started',
          sessionId: session.id,
          totalTemplates: session.total_templates,
          totalBatches: session.total_batches,
          batchSize
        });
      }

      case 'pause': {
        if (!activeBatchScraper || !currentSessionId) {
          return NextResponse.json(
            { error: 'No active batch scrape' },
            { status: 400 }
          );
        }

        await activeBatchScraper.pause();
        return NextResponse.json({ message: 'Session paused', sessionId: currentSessionId });
      }

      case 'resume': {
        if (!activeBatchScraper && currentSessionId) {
          // Try to resume interrupted session
          activeBatchScraper = new BatchScraper({
            concurrency,
            browserInstances,
            pagesPerBrowser,
            batchSize
          });

          await activeBatchScraper.init();
          const session = await activeBatchScraper.resumeInterruptedSession();

          if (!session) {
            await activeBatchScraper.close();
            activeBatchScraper = null;
            return NextResponse.json(
              { error: 'No session to resume' },
              { status: 400 }
            );
          }

          return NextResponse.json({
            message: 'Session resumed',
            sessionId: session.id
          });
        }

        if (activeBatchScraper) {
          await activeBatchScraper.resume();
          return NextResponse.json({
            message: 'Session resumed',
            sessionId: currentSessionId
          });
        }

        return NextResponse.json(
          { error: 'No session to resume' },
          { status: 400 }
        );
      }

      case 'stop': {
        if (!activeBatchScraper) {
          return NextResponse.json(
            { error: 'No active batch scrape' },
            { status: 400 }
          );
        }

        await activeBatchScraper.stop();
        await activeBatchScraper.close();
        activeBatchScraper = null;

        return NextResponse.json({
          message: 'Session stopped',
          sessionId: currentSessionId
        });
      }

      case 'skip': {
        const { templateId } = body;

        if (!activeBatchScraper || !templateId) {
          return NextResponse.json(
            { error: 'No active scraper or template ID missing' },
            { status: 400 }
          );
        }

        activeBatchScraper.requestSkip(templateId);
        return NextResponse.json({
          message: 'Skip requested',
          templateId
        });
      }

      case 'update_config': {
        // Update performance config for the next batch
        const { config } = body;

        if (!activeBatchScraper) {
          return NextResponse.json(
            { error: 'No active batch scrape to update' },
            { status: 400 }
          );
        }

        if (!config || typeof config !== 'object') {
          return NextResponse.json(
            { error: 'Config object required' },
            { status: 400 }
          );
        }

        const configUpdate: Partial<PerformanceConfig> = {};
        if (config.concurrency !== undefined) configUpdate.concurrency = config.concurrency;
        if (config.browserInstances !== undefined) configUpdate.browserInstances = config.browserInstances;
        if (config.pagesPerBrowser !== undefined) configUpdate.pagesPerBrowser = config.pagesPerBrowser;
        if (config.batchSize !== undefined) configUpdate.batchSize = config.batchSize;
        if (config.timeout !== undefined) configUpdate.timeout = config.timeout;

        const result = activeBatchScraper.updatePendingConfig(configUpdate);

        return NextResponse.json({
          message: 'Config scheduled for next batch',
          current: result.current,
          pending: result.pending,
          currentBatch: activeBatchScraper.getCurrentBatchNumber()
        });
      }

      case 'cancel_config': {
        // Cancel pending config changes
        if (!activeBatchScraper) {
          return NextResponse.json(
            { error: 'No active batch scrape' },
            { status: 400 }
          );
        }

        activeBatchScraper.cancelPendingConfig();

        return NextResponse.json({
          message: 'Pending config cancelled',
          current: activeBatchScraper.getCurrentConfig(),
          pending: null
        });
      }

      case 'get_config': {
        // Get current and pending config
        if (!activeBatchScraper) {
          return NextResponse.json(
            { error: 'No active batch scrape' },
            { status: 400 }
          );
        }

        return NextResponse.json({
          current: activeBatchScraper.getCurrentConfig(),
          pending: activeBatchScraper.getPendingConfig(),
          currentBatch: activeBatchScraper.getCurrentBatchNumber()
        });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Batch API error:', error);

    if (activeBatchScraper) {
      await activeBatchScraper.close();
      activeBatchScraper = null;
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Check admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get active session info
    const isActive = activeBatchScraper !== null;
    const interrupted = await getInterruptedSession();
    const resumable = await getResumableSessions();

    // Include config info if scraper is active
    const configInfo = activeBatchScraper ? {
      currentConfig: activeBatchScraper.getCurrentConfig(),
      pendingConfig: activeBatchScraper.getPendingConfig(),
      currentBatch: activeBatchScraper.getCurrentBatchNumber()
    } : null;

    return NextResponse.json({
      isActive,
      currentSessionId,
      hasInterruptedSession: !!interrupted,
      interruptedSession: interrupted,
      resumableSessions: resumable,
      config: configInfo
    });
  } catch (error) {
    console.error('Batch status error:', error);
    return NextResponse.json(
      { error: 'Failed to get batch status' },
      { status: 500 }
    );
  }
}
