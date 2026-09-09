import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  SQUARE_LANES,
  deleteOpinion,
  getSquareFeedUpdates,
  listSquareFeedPage,
  type SquareRefreshAnchor,
} from './social-content';

describe('social content delete contract', () => {
  beforeEach(() => callMock.mockReset());

  it('deletes by opinion id with the DELETE method and passes the bearer through', async () => {
    callMock.mockResolvedValue({data: {changed: true}});
    await expect(deleteOpinion('jwt', 409)).resolves.toEqual({changed: true});
    expect(callMock).toHaveBeenCalledWith('/v1/social/opinions/409', {method: 'DELETE', bearer: 'jwt'});
  });

  it('treats an omitted changed field as false so repeated deletes stay idempotent', async () => {
    callMock.mockResolvedValue({data: {}});
    await expect(deleteOpinion('jwt', 409)).resolves.toEqual({changed: false});
  });
});

describe('social content square feed contract', () => {
  beforeEach(() => callMock.mockReset());

  it('parses the opaque refresh anchor out of a feed page', async () => {
    callMock.mockResolvedValue({data: {items: [], refresh_anchor: 'anchor-1'}});
    await expect(listSquareFeedPage(SQUARE_LANES.NEWEST)).resolves.toEqual({
      items: [],
      refreshAnchor: 'anchor-1',
    });
    expect(callMock).toHaveBeenCalledWith('/v1/social/square/feed?lane=SQUARE_LANE_NEWEST', {
      bearer: undefined,
    });
  });

  it('passes cancellation only to the request options, never into the query', async () => {
    const controller = new AbortController();
    callMock.mockResolvedValue({data: {items: [], refresh_anchor: 'anchor-1'}});

    await listSquareFeedPage(SQUARE_LANES.NEWEST, {limit: 20, signal: controller.signal});

    expect(callMock).toHaveBeenCalledWith(
      '/v1/social/square/feed?lane=SQUARE_LANE_NEWEST&limit=20',
      {bearer: undefined, signal: controller.signal},
    );
  });

  it('keeps the refresh anchor absent when the page omits it', async () => {
    callMock.mockResolvedValue({data: {}});
    await expect(listSquareFeedPage(SQUARE_LANES.FOR_YOU)).resolves.toEqual({items: []});
  });

  it('parses the 2026-09-07 wire format: flattened oneof, explicit zero scalars, and zero-expansion folding', async () => {
    callMock.mockResolvedValue({data: {
      items: [{
        type: 1,
        source_id: '9',
        actor_identifier: 'author-1',
        sort_time: {seconds: 1787, nanos: 0},
        opinion: {
          opinion: {
            opinion_id: 9,
            author_identifier: 'author-1',
            target_type: 1,
            target_id: '56:erc20:0xabc:3',
            latest_version: {
              version_id: 11,
              version_no: 1,
              body: '看多',
              items: [{x_link: {url: 'https://x.com/a/status/1'}}, {x_link: null}],
              like_count: 0,
              published_at: {seconds: 1787, nanos: 5},
              viewer_like: false,
            },
            created_at: {seconds: 1787, nanos: 0},
            updated_at: {seconds: 1787, nanos: 0},
          },
          position: {pnl_percent: '', token_symbol: '', quality: ''},
        },
        actor: {identifier: 'author-1', nickname: 'Author'},
      }],
      next_cursor: '',
      refresh_anchor: '',
      as_of: {seconds: 0, nanos: 0},
    }});
    const page = await listSquareFeedPage(SQUARE_LANES.FOR_YOU);
    expect(page.nextCursor).toBeUndefined();
    expect(page.refreshAnchor).toBeUndefined();
    expect(page.asOf).toBeUndefined();
    const item = page.items[0];
    expect(item?.actor).toEqual({identifier: 'author-1', nickname: 'Author'});
    expect(item?.content.position).toBeUndefined();
    expect(item?.content.opinion.latestVersion).toMatchObject({
      versionID: 11,
      likeCount: 0,
      viewerLike: false,
      items: [{kind: 'x_link', url: 'https://x.com/a/status/1'}],
    });
  });
});

describe('social content square feed updates contract', () => {
  beforeEach(() => callMock.mockReset());

  it('always sends the lane and only appends a non-empty anchor to the query', async () => {
    callMock.mockResolvedValue({data: {}});
    await getSquareFeedUpdates(SQUARE_LANES.FOR_YOU, {
      anchor: 'anchor-9' as SquareRefreshAnchor,
      bearer: 'jwt',
    });
    expect(callMock).toHaveBeenCalledWith(
      '/v1/social/square/feed/updates?lane=SQUARE_LANE_FOR_YOU&anchor=anchor-9',
      {bearer: 'jwt'},
    );

    await getSquareFeedUpdates(SQUARE_LANES.FRIENDS);
    expect(callMock.mock.lastCall?.[0]).toBe('/v1/social/square/feed/updates?lane=SQUARE_LANE_FRIENDS');
    expect(callMock.mock.lastCall?.[1]).toEqual({bearer: undefined});

    await getSquareFeedUpdates(SQUARE_LANES.NEWEST);
    expect(callMock.mock.lastCall?.[0]).toBe('/v1/social/square/feed/updates?lane=SQUARE_LANE_NEWEST');
  });

  it('normalizes omitted count, has_more, and actors to 0, false, and an empty list', async () => {
    callMock.mockResolvedValue({data: {}});
    await expect(getSquareFeedUpdates(SQUARE_LANES.NEWEST, {
      anchor: 'anchor-9' as SquareRefreshAnchor,
    })).resolves.toEqual({
      count: 0,
      hasMore: false,
      actors: [],
    });
  });

  it('passes the opaque anchor and cancellation signal to the updates request', async () => {
    const controller = new AbortController();
    callMock.mockResolvedValue({data: {}});

    await getSquareFeedUpdates(SQUARE_LANES.NEWEST, {
      anchor: 'anchor-9' as SquareRefreshAnchor,
      signal: controller.signal,
    });

    expect(callMock).toHaveBeenCalledWith(
      '/v1/social/square/feed/updates?lane=SQUARE_LANE_NEWEST&anchor=anchor-9',
      {bearer: undefined, signal: controller.signal},
    );
  });

  it('normalizes the capped count, has_more, and deduplicated actors from a full payload', async () => {
    callMock.mockResolvedValue({
      data: {
        count: 99,
        has_more: true,
        actors: [
          {identifier: 'u1', username: 'alice', nickname: 'Alice', avatar_url: 'https://img/avatar.png'},
          {identifier: 'u2'},
        ],
      },
    });
    await expect(getSquareFeedUpdates(SQUARE_LANES.NEWEST)).resolves.toEqual({
      count: 99,
      hasMore: true,
      actors: [
        {identifier: 'u1', username: 'alice', nickname: 'Alice', avatarURL: 'https://img/avatar.png'},
        {identifier: 'u2'},
      ],
    });
  });

  it('rejects a payload whose count is not a safe JSON integer', async () => {
    callMock.mockResolvedValue({data: {count: 'many'}});
    await expect(getSquareFeedUpdates(SQUARE_LANES.NEWEST)).rejects.toThrow(
      'count is not a safe JSON integer',
    );
  });

  it('rejects a payload whose actors field is not an array', async () => {
    callMock.mockResolvedValue({data: {actors: {}}});
    await expect(getSquareFeedUpdates(SQUARE_LANES.NEWEST)).rejects.toThrow(
      'updates data.actors is not an array',
    );
  });
});
