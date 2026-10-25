import { fsProvider } from '../fs';
import { useExplorer } from './explorer';
import { useDocuments } from './documents';

/**
 * One subscription for the whole app, fanned out to both stores: the explorer refreshes
 * the listings it is showing, and the session decides what an external change means for
 * the open document.
 */
export function startWatching(): () => void {
  return fsProvider.watch((event) => {
    useExplorer.getState().applyWatchEvent(event);
    useDocuments.getState().applyWatchEvent(event);
  });
}
