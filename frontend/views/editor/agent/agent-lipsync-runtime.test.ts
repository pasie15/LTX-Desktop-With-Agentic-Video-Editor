import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyLipSyncWithBackend, resolveShotLipSyncAudio } from './agent-lipsync-runtime.ts'

describe('agent lipsync runtime', () => {
  it('posts video and audio paths to the backend', async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      assert.equal(url, '/api/lipsync')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      assert.equal(body.videoPath, '/tmp/talk.mp4')
      assert.equal(body.audioPath, '/tmp/line.mp3')
      assert.equal(body.provider, 'auto')
      return new Response(JSON.stringify({
        path: '/tmp/synced.mp4',
        provider: 'fal',
        model: 'fal-ai/sync-lipsync/v3',
      }), { status: 200 })
    }
    const result = await applyLipSyncWithBackend({
      videoPath: '/tmp/talk.mp4',
      audioPath: '/tmp/line.mp3',
      fetchImpl: fetchImpl as typeof fetch,
    })
    assert.ok(!('error' in result))
    assert.equal(result.path, '/tmp/synced.mp4')
    assert.equal(result.provider, 'fal')
  })

  it('surfaces runway fallback reason from the backend', async () => {
    const result = await applyLipSyncWithBackend({
      videoPath: '/tmp/talk.mp4',
      audioPath: '/tmp/line.mp3',
      provider: 'runway',
      fetchImpl: (async () => new Response(JSON.stringify({
        path: '/tmp/synced.mp4',
        provider: 'fal',
        model: 'fal-ai/sync-lipsync/v3',
        fallbackReason: 'Runway official API has no dedicated lip-sync.',
      }), { status: 200 })) as typeof fetch,
    })
    assert.ok(!('error' in result))
    assert.match(result.fallbackReason ?? '', /no dedicated lip-sync/)
  })

  it('needs a sung or spoken line before assembling lip-sync audio', async () => {
    const skipped = await resolveShotLipSyncAudio({
      getState: () => ({ editorModel: { assets: [], timelines: [], activeTimelineId: '' } }) as never,
      applyWithHistory: () => {},
      actions: {} as never,
    }, { lipSync: true })
    assert.ok('skipped' in skipped)

    const synthesized = await resolveShotLipSyncAudio({
      getState: () => ({ editorModel: { assets: [], timelines: [], activeTimelineId: '' } }) as never,
      applyWithHistory: () => {},
      actions: {} as never,
      speech: {
        synthesize: async ({ text }) => ({ path: `/tmp/${text}.mp3` }),
      },
    }, { lipSync: true, dialogue: 'Wait on the stoop.' })
    assert.ok('path' in synthesized)
    assert.equal(synthesized.path, '/tmp/Wait on the stoop..mp3')
  })
})
