import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {completeXBindViaPrivy} from './ximport';
import {firstPrompt, getOnboarding, skipOnboarding} from './onboarding';

describe('onboarding contract', () => {
  beforeEach(() => callMock.mockReset());

  it('GET and skip hit the two endpoints; skip echoes the feature verbatim', async () => {
    const items = [
      {feature: 'invite', done: true},
      {feature: 'nickname', should_prompt: true},
    ];
    callMock.mockResolvedValue({data: {items}});
    await getOnboarding('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/user/onboarding', {bearer: 'jwt', signal: undefined});

    callMock.mockResolvedValue({data: {items: [{feature: 'nickname', skipped: true}]}});
    await skipOnboarding('jwt', 'nickname');
    expect(callMock).toHaveBeenCalledWith('/v1/user/onboarding/skip', {
      method: 'POST',
      bearer: 'jwt',
      body: {feature: 'nickname'},
    });
  });

  it('firstPrompt picks the first truthy should_prompt — never === false (absent keys are false)', () => {
    expect(firstPrompt([{feature: 'invite', done: true}, {feature: 'nickname', should_prompt: true}, {feature: 'x_bind', should_prompt: true}])).toEqual({
      feature: 'nickname',
      should_prompt: true,
    });
    expect(firstPrompt([{feature: 'invite', done: true}, {feature: 'nickname', skipped: true}])).toBeNull();
    expect(firstPrompt([])).toBeNull();
  });

  it('unknown feature codes are ignorable, not errors (server adds items over time)', () => {
    expect(firstPrompt([{feature: 'future_thing', should_prompt: true}, {feature: 'x_bind'}])).toEqual({
      feature: 'future_thing',
      should_prompt: true,
    });
  });
});

describe('x-import privy channel', () => {
  beforeEach(() => callMock.mockReset());

  it('completeXBindViaPrivy posts an empty body with bearer', async () => {
    callMock.mockResolvedValue({data: {bound: true, bind_source: 2}});
    await completeXBindViaPrivy('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/user/x/bind/privy', {method: 'POST', body: {}, bearer: 'jwt'});
  });
});
