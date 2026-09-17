import {notFound} from 'next/navigation';
import {PinnedPreview} from './PinnedPreview';

export default function PinnedPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <PinnedPreview />;
}
