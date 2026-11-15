import { useData } from '@/lib/data';
import { timeAgo } from '@/lib/time';
import { Notice } from './ui';

export function OfflineNotice() {
  const { status, savedAt } = useData();
  if (status !== 'offline') return null;
  return (
    <Notice icon="cloud-off-outline">
      {`Can't reach the server. Showing the list from ${timeAgo(savedAt) || 'earlier'}; changes need a connection.`}
    </Notice>
  );
}
