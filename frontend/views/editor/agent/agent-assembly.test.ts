import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assemblyConfirmQuestions,
  buildAssemblyProposal,
  countAssemblyGenerateJobs,
  isAssemblyAcceptChoice,
  isAssemblyProceedChoice,
  MAX_ASSEMBLY_GENERATE_JOBS,
  normalizeAssemblyShots,
  parseScriptToShots,
  serializeAssemblyShots,
} from './agent-assembly.ts'

describe('script to shot list', () => {
  it('parses scene slugs into titled shots', () => {
    const shots = parseScriptToShots(
      'INT. KITCHEN - DAY\nA woman pours coffee.\n\nEXT. STREET - NIGHT\nRain on asphalt.',
    )
    assert.equal(shots.length, 2)
    assert.equal(shots[0]?.title, 'KITCHEN - DAY')
    assert.match(shots[0]?.prompt ?? '', /pours coffee/)
    assert.equal(shots[1]?.title, 'STREET - NIGHT')
    assert.equal(shots[0]?.duration, 4)
  })

  it('parses numbered lines and duration suffixes', () => {
    const shots = parseScriptToShots('1. Hands pour coffee [4s]\n2. Street in rain (6s)')
    assert.equal(shots.length, 2)
    assert.equal(shots[0]?.prompt, 'Hands pour coffee')
    assert.equal(shots[0]?.duration, 4)
    assert.equal(shots[1]?.prompt, 'Street in rain')
    assert.equal(shots[1]?.duration, 6)
  })

  it('treats a single paragraph as one shot', () => {
    const shots = parseScriptToShots('A quiet kitchen at dawn, steam from a kettle.')
    assert.equal(shots.length, 1)
    assert.equal(shots[0]?.prompt, 'A quiet kitchen at dawn, steam from a kettle.')
  })

  it('round-trips serialize then parse titles', () => {
    const original = normalizeAssemblyShots([
      { id: 's1', prompt: 'coffee pour', duration: 4, title: 'KITCHEN' },
    ])
    assert.ok(original)
    const again = parseScriptToShots(serializeAssemblyShots(original))
    assert.equal(again[0]?.title, 'KITCHEN')
    assert.match(again[0]?.prompt ?? '', /coffee pour/)
  })
})

describe('assembly job cap', () => {
  it('counts still plus video as two jobs unless a still is reused', () => {
    assert.equal(countAssemblyGenerateJobs([
      { id: 'a', prompt: 'one', duration: 4 },
      { id: 'b', prompt: 'two', duration: 4, imageAssetId: 'asset-1' },
    ], false), 3)
    assert.equal(countAssemblyGenerateJobs([
      { id: 'a', prompt: 'theme', duration: 12, assetId: 'aud-1' },
      { id: 'b', prompt: 'two', duration: 4, imageAssetId: 'asset-1' },
    ], false), 1)
    assert.equal(countAssemblyGenerateJobs([
      { id: 'a', prompt: 'one', duration: 4 },
      { id: 'b', prompt: 'two', duration: 4 },
    ], true), 2)
  })

  it('flags more than eight generate jobs on the confirm card', () => {
    const shots = Array.from({ length: 5 }, (_, index) => ({
      id: `s${index + 1}`,
      prompt: `shot ${index + 1}`,
      duration: 4,
    }))
    const proposal = buildAssemblyProposal({ shots })
    assert.equal(proposal.jobCount, 10)
    assert.equal(proposal.exceedsJobCap, true)
    assert.ok(proposal.jobCount > MAX_ASSEMBLY_GENERATE_JOBS)
    const questions = assemblyConfirmQuestions(proposal)
    assert.equal(questions[0]?.kind, 'shot_list')
    assert.ok(questions[0]?.options?.some(option => option.startsWith('Proceed with ')))
    assert.equal(isAssemblyProceedChoice('Proceed with 10 sequential generates'), true)
    assert.equal(isAssemblyAcceptChoice('Accept'), true)
    assert.equal(isAssemblyAcceptChoice('Edit'), false)
  })
})
