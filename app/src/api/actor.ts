export type ActorIdentity = {type: 'smartx_user' | 'external_user' | 'wallet'; id?: string; namespace?: string; address?: string};
export type ActorView = {
  identity: ActorIdentity;
  name: string;
  username?: string;
  avatarURL?: string;
  sources: string[];
  wallets: ActorIdentity[];
  relatedIdentities: ActorIdentity[];
  profileSubject?: ActorIdentity;
  relationState: 'anonymous' | 'available' | 'unavailable';
  following: boolean;
  followingPrimary: boolean;
  followedSubjects: ActorIdentity[];
  remarkSubject?: ActorIdentity;
  remark?: string;
  sharedWallets: boolean;
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown): string | undefined => typeof v === 'string' && v !== '' ? v : undefined;
export function actorKey(id: ActorIdentity): string {
  return id.type === 'wallet' ? `${id.type}:${id.namespace}:${id.namespace === 'evm' ? id.address?.toLowerCase() : id.address}` : `${id.type}:${id.id}`;
}
export function normalizeActorIdentity(value: unknown): ActorIdentity {
  const id = record(value);
  if (id.type !== 'smartx_user' && id.type !== 'external_user' && id.type !== 'wallet') throw new TypeError('Missing typed actor identity');
  if (id.type === 'wallet' ? !string(id.address) || !['evm', 'solana'].includes(String(id.namespace)) : !string(id.id)) throw new TypeError('Incomplete actor identity');
  return {type: id.type, id: string(id.id), namespace: string(id.namespace), address: string(id.address)};
}
function identities(value: unknown): ActorIdentity[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('Invalid actor identity list');
  return [...new Map(value.map(normalizeActorIdentity).map((id) => [actorKey(id), id])).values()];
}
export function normalizeActor(value: unknown): ActorView {
  const row = record(value), profile = record(row.profile), viewer = record(row.viewer);
  const identity = normalizeActorIdentity(row.identity);
  if (!['anonymous', 'available', 'unavailable'].includes(String(viewer.state))) throw new TypeError('Missing actor relation state');
  const sources = profile.sources ?? [];
  if (!Array.isArray(sources) || sources.some((s) => typeof s !== 'string')) throw new TypeError('Invalid actor sources');
  const wallets = row.wallets === undefined && identity.type === 'wallet' ? [identity] : identities(row.wallets);
  if (wallets.some((id) => id.type !== 'wallet')) throw new TypeError('Actor wallets must be wallet identities');
  const followedSubjects = viewer.state === 'available' ? identities(viewer.followed_subjects) : [];
  return {
    identity, name: string(profile.display_name) ?? string(profile.username) ?? identity.address ?? identity.id!,
    username: string(profile.username), avatarURL: string(profile.avatar_url), sources: sources as string[],
    wallets, relatedIdentities: identities(row.related_identities),
    profileSubject: string(record(row.profile_subject).type) ? normalizeActorIdentity(row.profile_subject) : undefined,
    relationState: viewer.state as ActorView['relationState'], following: viewer.state === 'available' && viewer.following === true,
    followingPrimary: viewer.state === 'available' && followedSubjects.some((id) => actorKey(id) === actorKey(identity)),
    followedSubjects, remarkSubject: string(record(viewer.remark_subject).type) ? normalizeActorIdentity(viewer.remark_subject) : undefined,
    remark: viewer.state === 'available' ? string(viewer.remark) : undefined, sharedWallets: row.has_shared_wallets === true,
  };
}
