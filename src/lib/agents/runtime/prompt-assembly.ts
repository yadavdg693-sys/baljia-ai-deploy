import { createLocalRepoModePlan, shouldUseLocalRepoMode } from './local-repo-mode';
import type { ContextPacket } from '@/types';
import {
  ENGINEERING_SUBAGENTS,
  buildEngineeringLanePackets,
  requiredEngineeringSubagents,
  type EngineeringLanePacket,
} from './engineering-subagents';

export function engineeringRuntimeAddendum(input: string | {
  taskText: string;
  task?: { title?: string | null; description?: string | null; tag?: string | null };
  contextPacket?: ContextPacket;
}): string {
  const taskText = typeof input === 'string' ? input : input.taskText;
  const task = typeof input === 'string'
    ? { title: '', description: taskText, tag: 'engineering' }
    : input.task ?? { title: '', description: taskText, tag: 'engineering' };
  const contextPacket = typeof input === 'string' ? undefined : input.contextPacket;
  const lines = [
    '## Engineering Runtime Architecture',
    '- Parent Engineering Agent owns goal, budget, permissions, completion gate, and final report.',
    '- Subagents may plan, build, verify, review, or repair, but cannot mark tasks complete.',
    '- Frontend, Graphify, and RAG remain policy gates when relevant.',
  ];

  const roles = requiredEngineeringSubagents(taskText);
  lines.push(`- Selected bounded Engineering lanes for this task: ${roles.length ? roles.map((role) => role.toUpperCase()).join(', ') : 'none (direct small-task execution)'}.`);
  if (roles.length > 0) {
    lines.push('- For each selected lane, call `record_engineering_lane_output` when that lane is completed, skipped, or blocked.');
    lines.push('- Lane output is supporting evidence only. It does not replace deploy, browser, DB, Product Build Contract, field, or auth-isolation proof.');
    lines.push(`- Lane ownership: ${roles.map((role) => `${role}=${ENGINEERING_SUBAGENTS[role].owns.join('/')}`).join('; ')}.`);
    lines.push(formatLanePackets(buildEngineeringLanePackets({
      task,
      contextPacket,
      roles,
    })));
  }

  if (shouldUseLocalRepoMode(taskText)) {
    lines.push(`- Local-repo mode plan: ${createLocalRepoModePlan(taskText).steps.join(' -> ')}.`);
  }

  return lines.join('\n');
}

function formatLanePackets(packets: Partial<Record<string, EngineeringLanePacket>>): string {
  const rendered = Object.values(packets)
    .filter((packet): packet is EngineeringLanePacket => Boolean(packet))
    .map((packet) => {
      const contextHints = [
        `company_state=${packet.context.companyState ? `${packet.context.companyState.lifecycle}/${packet.context.companyState.billing_state}` : 'unknown'}`,
        `codebase_map=${packet.context.codebaseMap ? 'present' : 'missing'}`,
        `founder_preferences=${truncate(packet.context.founderPreferences ?? '', 240) || 'none'}`,
        `domain_knowledge=${truncate(packet.context.domainKnowledge ?? '', 240) || 'none'}`,
      ];
      return [
        `### ${packet.role.toUpperCase()} Lane Packet`,
        `- Task: ${truncate(packet.task.title || packet.task.description, 160)}`,
        `- Instructions: ${packet.instructions.join(' ')}`,
        `- Context: ${contextHints.join('; ')}`,
      ].join('\n');
    });
  return ['## Engineering Lane Packets', ...rendered].join('\n');
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}
