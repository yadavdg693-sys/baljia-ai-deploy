// Slack Notification Service — workspace integrations + alerts
// Sends founder notifications, task updates, and escalation alerts
//
// Env: SLACK_BOT_TOKEN, SLACK_DEFAULT_CHANNEL

import { createLogger } from '@/lib/logger';

const log = createLogger('Slack');

const SLACK_API_BASE = 'https://slack.com/api';

export function isSlackConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN;
}

// ══════════════════════════════════════════════
// SLACK API CALLER
// ══════════════════════════════════════════════

async function slackApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

  const response = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json() as { ok: boolean; error?: string } & T;

  if (!result.ok) {
    log.error('Slack API error', { method, error: result.error });
    throw new Error(`Slack API error: ${result.error}`);
  }

  return result;
}

// ══════════════════════════════════════════════
// SEND MESSAGE — to a channel or DM
// ══════════════════════════════════════════════

interface SlackMessage {
  channel: string;       // Channel ID or user ID for DMs
  text: string;          // Fallback text (shown in notifications)
  blocks?: SlackBlock[]; // Rich formatting blocks
}

type SlackBlock =
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'divider' }
  | { type: 'header'; text: { type: 'plain_text'; text: string } }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> };

export async function sendMessage(message: SlackMessage): Promise<{ ts: string }> {
  if (!isSlackConfigured()) {
    log.debug('Slack not configured, message skipped', { channel: message.channel });
    return { ts: '0' };
  }

  const result = await slackApi<{ ts: string }>('chat.postMessage', {
    channel: message.channel,
    text: message.text,
    blocks: message.blocks,
    unfurl_links: false,
    unfurl_media: false,
  });

  log.info('Slack message sent', { channel: message.channel });
  return { ts: result.ts };
}

// ══════════════════════════════════════════════
// CONVENIENCE — pre-built notifications
// ══════════════════════════════════════════════

const defaultChannel = () => process.env.SLACK_DEFAULT_CHANNEL ?? '#general';

export async function notifyTaskCompleted(
  companyName: string,
  taskTitle: string,
  result: string
) {
  return sendMessage({
    channel: defaultChannel(),
    text: `✅ ${companyName}: Task "${taskTitle}" completed`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `✅ Task Completed` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${companyName}*\n${taskTitle}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${result.substring(0, 500)}\`\`\`` } },
    ],
  });
}

export async function notifyTaskFailed(
  companyName: string,
  taskTitle: string,
  error: string
) {
  return sendMessage({
    channel: defaultChannel(),
    text: `❌ ${companyName}: Task "${taskTitle}" failed`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `❌ Task Failed` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${companyName}*\n${taskTitle}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `Error: ${error.substring(0, 500)}` } },
    ],
  });
}

export async function notifyEscalation(
  companyName: string,
  subject: string,
  details: string
) {
  return sendMessage({
    channel: defaultChannel(),
    text: `🚨 ESCALATION: ${companyName} — ${subject}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🚨 Escalation Required` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${companyName}*\n${subject}` } },
      { type: 'section', text: { type: 'mrkdwn', text: details.substring(0, 1000) } },
    ],
  });
}

export async function notifyNewSignup(founderName: string, companyName: string, email: string) {
  return sendMessage({
    channel: defaultChannel(),
    text: `🎉 New signup: ${founderName} (${companyName})`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🎉 New Founder Signup` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${founderName}*\nCompany: ${companyName}\nEmail: ${email}` } },
    ],
  });
}

export async function notifyNightShiftSummary(companyName: string, summary: string) {
  return sendMessage({
    channel: defaultChannel(),
    text: `🌙 Night shift complete: ${companyName}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🌙 Night Shift — ${companyName}` } },
      { type: 'section', text: { type: 'mrkdwn', text: summary.substring(0, 2000) } },
    ],
  });
}
