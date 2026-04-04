import { Metadata } from 'next';
import { LiveWall } from '@/components/live/LiveWall';

export const metadata: Metadata = {
  title: 'Baljia — Live Operations Wall',
  description: 'Watch AI agents build businesses in real-time. Live tasks, metrics, and activity from the Baljia platform.',
};

export default function LivePage() {
  return <LiveWall />;
}
