import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assemblyConfirmQuestions,
  bindAssemblyUserMedia,
  buildAssemblyProposal,
  countAssemblyGenerateJobs,
  inferAssemblyMediaFromAssets,
  isAssemblyAcceptChoice,
  isAssemblyProceedChoice,
  MAX_ASSEMBLY_GENERATE_JOBS,
  normalizeAssemblyShots,
  parseScriptToShots,
  serializeAssemblyShots,
  shotShowsProtagonist,
  stillPromptForShot,
  videoPromptForShot,
  characterSheetPrompt,
  deriveCharacterSheets,
  attachExistingCharacterSheets,
  dedupeCharacterSheets,
  findExistingCharacterSheet,
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

  it('binds a portrait as character identity, not every shot start frame', () => {
    assert.deepEqual(inferAssemblyMediaFromAssets([
      { id: 'ken', type: 'image' },
      { id: 'river', type: 'audio' },
    ]), { referenceAssetId: 'ken', musicAssetId: 'river' })
    const proposal = bindAssemblyUserMedia(
      buildAssemblyProposal({
        kind: 'music_video',
        shots: Array.from({ length: 8 }, (_, index) => ({
          id: `s${index + 1}`,
          prompt: `shot ${index + 1}`,
          duration: 5,
        })),
      }),
      { imageAssetId: 'ken', musicAssetId: 'river' },
    )
    assert.equal(proposal.musicAssetId, 'river')
    assert.equal(proposal.referenceAssetId, 'ken')
    assert.equal(proposal.characterSheets?.length, 1)
    assert.equal(proposal.jobCount, 17)
    assert.equal(proposal.exceedsJobCap, true)
    assert.ok(proposal.shots.every(shot => !shot.imageAssetId && !shot.skipStill))
  })

  it('strips a portrait the model stuffed onto every shot as imageAssetId', () => {
    const proposal = bindAssemblyUserMedia(
      buildAssemblyProposal({
        kind: 'music_video',
        shots: [
          { id: 's1', prompt: 'bridge at night', duration: 5, imageAssetId: 'ken', skipStill: true },
          { id: 's2', prompt: 'wet street', duration: 5, imageAssetId: 'ken' },
        ],
        referenceAssetId: 'ken',
      }),
      { referenceAssetId: 'ken' },
    )
    assert.equal(proposal.referenceAssetId, 'ken')
    assert.ok(proposal.shots.every(shot => !shot.imageAssetId && !shot.skipStill))
    assert.equal(proposal.characterSheets?.length, 1)
    assert.equal(proposal.jobCount, 5)
  })

  it('counts a last-frame still as an extra generate job', () => {
    assert.equal(countAssemblyGenerateJobs([
      { id: 'a', prompt: 'one', duration: 4, lastFramePrompt: 'end pose' },
    ], false), 3)
  })

  it('builds scene still and video prompts from wardrobe, identity, and dialogue', () => {
    assert.equal(shotShowsProtagonist({ showProtagonist: false }), false)
    assert.equal(shotShowsProtagonist({ showProtagonist: true }), true)
    assert.equal(shotShowsProtagonist({ refId: 'hero' }), true)
    const hero = stillPromptForShot({
      id: 's1',
      prompt: 'stage light',
      duration: 5,
      firstFramePrompt: 'Ken on a wet street at night',
      showProtagonist: true,
      wardrobe: 'black leather jacket, not the portrait tee',
      dialogue: 'I keep walking',
      lipSync: true,
    })
    assert.match(hero, /^Cinematic 16:9 production still/)
    assert.match(hero, /Ken on a wet street/)
    assert.match(hero, /black leather jacket/)
    assert.match(hero, /referenced person is inside this location/)
    assert.match(hero, /Not a copy of a reference portrait/)
    assert.match(hero, /Mouth beginning/)
    const broll = stillPromptForShot({
      id: 's2',
      prompt: 'empty bridge',
      duration: 4,
      showProtagonist: false,
    })
    assert.match(broll, /Do not show the protagonist/)
    assert.match(broll, /wide establishing shot/)
    assert.doesNotMatch(broll, /A person stands or walks/)
    const talking = videoPromptForShot({
      id: 's3',
      prompt: 'close-up singing',
      duration: 6,
      dialogue: 'Midnight by the river',
      lipSync: true,
    })
    assert.match(talking, /lip sync/)
    assert.match(talking, /Midnight by the river/)
    const duet = videoPromptForShot({
      id: 's4',
      prompt: 'Ken on the bridge',
      duration: 5,
      performance: 'singing',
      address: 'with_others',
      performers: 'both protagonists',
      others: 'the second lead',
      objects: 'streetlamp, wet railing',
      environment: 'midnight river fog, sodium light',
      dialogue: 'Midnight by the river',
    })
    assert.match(duet, /singing/)
    assert.match(duet, /second lead/)
    assert.match(duet, /streetlamp/)
    assert.match(duet, /fog/)
    const parsed = normalizeAssemblyShots([{
      prompt: 'duet on the bridge',
      duration: 4,
      performance: 'singing',
      address: 'with_others',
      performers: 'both protagonists',
    }])
    assert.equal(parsed?.[0]?.lipSync, true)
    assert.equal(parsed?.[0]?.performance, 'singing')
  })

  it('derives a character sheet lookbook from the portrait and wardrobe looks', () => {
    const sheets = deriveCharacterSheets({
      referenceAssetId: 'ken',
      shots: [
        { id: 's1', prompt: 'bridge', duration: 5, showProtagonist: true, wardrobe: 'black leather jacket' },
        { id: 's2', prompt: 'river', duration: 5, showProtagonist: true, wardrobe: 'wet coat' },
        { id: 's3', prompt: 'empty street', duration: 4, showProtagonist: false },
      ],
      character: { name: 'Ken Tune', identity: 'the artist from the portrait' },
    })
    assert.equal(sheets.length, 1)
    assert.match(sheets[0]?.prompt ?? '', /^Full-body character reference sheet/)
    assert.match(sheets[0]?.prompt ?? '', /T-pose front/)
    assert.match(sheets[0]?.prompt ?? '', /Character sheet/)
    assert.match(sheets[0]?.prompt ?? '', /Ken Tune/)
    assert.match(sheets[0]?.prompt ?? '', /black leather jacket/)
    assert.match(sheets[0]?.prompt ?? '', /wet coat/)
    assert.match(characterSheetPrompt({ character: { name: 'Ken' } }), /Not a cropped headshot/)
    assert.deepEqual(deriveCharacterSheets({
      skipStills: true,
      referenceAssetId: 'ken',
      shots: [{ id: 's1', prompt: 'bridge', duration: 5, showProtagonist: true }],
    }), [])
  })

  it('never uses a T-pose first-frame note as a lookbook start frame', () => {
    const framed = stillPromptForShot({
      id: 's1',
      prompt: 'Ken at the midnight river',
      duration: 5,
      firstFramePrompt: 'T-pose character sheet of Ken on the riverbank, lookbook',
      showProtagonist: true,
    })
    assert.match(framed, /^Cinematic 16:9 production still/)
    assert.doesNotMatch(framed, /T-pose/)
    assert.doesNotMatch(framed, /lookbook/)
    assert.match(framed, /river/)
  })

  it('keeps one sheet per character and type, and reuses one already in the bin', () => {
    const duped = deriveCharacterSheets({
      referenceAssetId: 'ken',
      shots: [{ id: 's1', prompt: 'bridge', duration: 5, showProtagonist: true }],
      characterSheets: [
        { id: 'sheet-1', prompt: 'Character sheet / lookbook of Ken', look: 'Ken' },
        { id: 'sheet-2', prompt: 'Another lookbook of Ken, T-pose', look: 'Ken' },
        { id: 'sheet-face', prompt: 'Face sheet of Ken, headshot only', kind: 'face', look: 'Ken' },
      ],
    })
    assert.equal(duped.filter(sheet => sheet.kind === 'lookbook').length, 1)
    assert.equal(duped.filter(sheet => sheet.kind === 'face').length, 1)
    assert.deepEqual(dedupeCharacterSheets([
      { id: 'a', prompt: 'lookbook', kind: 'lookbook', referenceAssetId: 'ken' },
      { id: 'b', prompt: 'lookbook again', kind: 'lookbook', referenceAssetId: 'ken' },
    ]).map(sheet => sheet.id), ['a'])

    const existing = {
      id: 'sheet-existing',
      type: 'image',
      generationParams: { prompt: 'Full-body character reference sheet, T-pose front of Ken Tune' },
    }
    assert.equal(findExistingCharacterSheet([existing], {
      prompt: 'Character sheet of Ken',
      look: 'Ken Tune',
    })?.id, 'sheet-existing')
    const attached = attachExistingCharacterSheets(
      [{ id: 'sheet-1', prompt: 'Character sheet of Ken Tune', kind: 'lookbook', look: 'Ken Tune' }],
      [existing],
      'Ken Tune',
    )
    assert.equal(attached[0]?.existingAssetId, 'sheet-existing')
  })

  it('derives one full-body sheet per character ref', () => {
    const sheets = deriveCharacterSheets({
      shots: [{ id: 's1', prompt: 'duet on the bridge', duration: 5, showProtagonist: true }],
      characterRefs: [
        { id: 'ken', name: 'Ken Tune', assetId: 'ken-jpg', role: 'character' },
        { id: 'maya', name: 'Maya', assetId: 'maya-jpg', role: 'character' },
      ],
    })
    assert.equal(sheets.length, 2)
    assert.equal(sheets[0]?.referenceAssetId, 'ken-jpg')
    assert.equal(sheets[1]?.referenceAssetId, 'maya-jpg')
    assert.match(sheets[0]?.prompt ?? '', /T-pose/)
    assert.match(sheets[1]?.prompt ?? '', /Maya/)
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
