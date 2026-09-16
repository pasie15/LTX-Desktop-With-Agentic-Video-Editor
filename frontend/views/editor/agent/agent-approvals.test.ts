import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  checkpointFromGenerate,
  detectApproveAllIntent,
  isApprovalNo,
  isApprovalYes,
  nextStepForCheckpoint,
  reviewDecisionFromAnswers,
  reviewQuestionsFromResult,
} from './agent-approvals.ts'

describe('agent approvals', () => {
  it('detects approve-all and ask-each-step phrasing', () => {
    assert.equal(detectApproveAllIntent('Just do it, make the whole film'), true)
    assert.equal(detectApproveAllIntent("Don't ask, full autonomy"), true)
    assert.equal(detectApproveAllIntent('Approve all and keep going'), true)
    assert.equal(detectApproveAllIntent('Wait for my approval on each shot'), false)
    assert.equal(detectApproveAllIntent('Ask me each step'), false)
    assert.equal(detectApproveAllIntent('Make a short film about a paper boy'), null)
  })

  it('classifies review answers', () => {
    assert.equal(isApprovalYes('Approve'), true)
    assert.equal(isApprovalYes(['yes']), true)
    assert.equal(isApprovalNo('Reject'), true)
    assert.equal(reviewDecisionFromAnswers({ review: 'Revise', revise: 'warmer light' }), 'revise')
    assert.equal(reviewDecisionFromAnswers({ confirm: 'no' }), 'reject')
  })

  it('labels stills vs sheets vs video from the prompt', () => {
    assert.equal(checkpointFromGenerate({ prompt: 'character sheet of the paper boy' }, 'image'), 'character_sheet')
    assert.equal(checkpointFromGenerate({ prompt: 'last-frame of the stoop' }, 'image'), 'last_frame')
    assert.equal(checkpointFromGenerate({ prompt: 'wide street, dusk' }, 'image'), 'still')
    assert.equal(checkpointFromGenerate({ prompt: 'rides past' }, 'video'), 'video')
  })

  it('names the next approval after a sheet or start frame', () => {
    assert.equal(nextStepForCheckpoint('character_sheet'), 'scene start frames')
    assert.equal(nextStepForCheckpoint('still'), 'the next start frame or video')
    assert.equal(nextStepForCheckpoint('last_frame'), 'the next start frame or video')
    assert.equal(nextStepForCheckpoint('video'), 'the next video')
  })

  it('builds an approval card from a needsReview tool result', () => {
    const questions = reviewQuestionsFromResult({
      needsReview: true,
      checkpoint: 'still',
      shotTitle: 'STOOP',
      nextStep: 'video',
      assetId: 'asset-still',
      preview: { mimeType: 'image/png', data: 'abc', name: 'stoop' },
    })
    assert.equal(questions?.[0]?.kind, 'approval')
    assert.equal(questions?.[0]?.assetId, 'asset-still')
    assert.deepEqual(questions?.[0]?.options, ['Approve', 'Revise', 'Reject'])
    assert.equal(questions?.[0]?.preview?.data, 'abc')
    assert.match(questions?.[0]?.prompt ?? '', /STOOP/)
  })
})
