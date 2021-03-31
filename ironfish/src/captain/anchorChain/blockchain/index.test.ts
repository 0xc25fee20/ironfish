/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Assert } from '../../../assert'
import { AsyncUtils } from '../../../utils'
import { createNodeTest, useAccountFixture, useBlockFixture } from '../../../testUtilities'
import { makeBlockAfter, addBlocksShuffle } from '../../testUtilities'

describe('Blockchain', () => {
  const nodeTest = createNodeTest()

  it('add blocks and build graphs', async () => {
    const { strategy, chain } = nodeTest
    strategy.disableMiningReward()

    await nodeTest.node.seed()
    const genesis = await chain.getGenesisHeader()
    Assert.isNotNull(genesis)

    // G -> A1 -> A2
    //         -> B2 -> B3

    const blockA1 = makeBlockAfter(chain, genesis)
    const blockA2 = makeBlockAfter(chain, blockA1)
    const blockB2 = makeBlockAfter(chain, blockA1)
    const blockB3 = makeBlockAfter(chain, blockB2)

    // Added in a specific order for the test below
    // so that Genesis, A1, A2, have the same graph,
    // and B2 merges into graph [A1-A2], and [A1-A2] merge
    // into genesis block graph so [B2-B3] -> [A2,A2,Genesis]
    await chain.addBlock(blockA1)
    await chain.addBlock(blockA2)
    await chain.addBlock(blockB2)
    await chain.addBlock(blockB3)

    const headerGenesis = await chain.getBlockHeader(genesis.hash)
    const headerA1 = await chain.getBlockHeader(blockA1.header.hash)
    const headerA2 = await chain.getBlockHeader(blockA2.header.hash)
    const headerB2 = await chain.getBlockHeader(blockB2.header.hash)
    const headerB3 = await chain.getBlockHeader(blockB3.header.hash)

    Assert.isNotNull(headerGenesis)
    Assert.isNotNull(headerA1)
    Assert.isNotNull(headerA2)
    Assert.isNotNull(headerB2)
    Assert.isNotNull(headerB3)

    const graphGenesis = await chain.getGraph(genesis.graphId)
    const graphA1 = await chain.getGraph(headerA1.graphId)
    const graphA2 = await chain.getGraph(headerA2.graphId)
    const graphB2 = await chain.getGraph(headerB2.graphId)
    const graphB3 = await chain.getGraph(headerB3.graphId)

    Assert.isNotNull(graphGenesis)
    Assert.isNotNull(graphA1)
    Assert.isNotNull(graphA2)
    Assert.isNotNull(graphB2)
    Assert.isNotNull(graphB3)

    expect(headerA1.graphId).toEqual(headerGenesis.graphId)
    expect(headerA2.graphId).toEqual(headerA1.graphId)
    expect(headerB2.graphId).not.toEqual(headerA1.graphId)
    expect(headerB3.graphId).toEqual(headerB2.graphId)

    expect(graphGenesis.mergeId).toEqual(null)
    expect(graphA1.mergeId).toEqual(null)
    expect(graphA2.mergeId).toEqual(null)
    expect(graphB2.mergeId).toEqual(headerA2.graphId)
    expect(graphB3.mergeId).toEqual(headerA2.graphId)

    expect(graphGenesis.tailHash?.equals(genesis.hash)).toBe(true)
    expect(graphGenesis.latestHash?.equals(headerB3.hash)).toBe(true)
    expect(graphGenesis.heaviestHash?.equals(headerB3.hash)).toBe(true)
  })

  it('iterateToBlock', async () => {
    const { strategy, chain } = nodeTest
    strategy.disableMiningReward()

    await nodeTest.node.seed()
    const genesis = await chain.getGenesisHeader()
    Assert.isNotNull(genesis)

    // G -> A1 -> A2
    //         -> B2 -> B3
    //               -> C3 -> C4
    //                     -> D4

    const blockA1 = makeBlockAfter(chain, genesis)
    const blockA2 = makeBlockAfter(chain, blockA1)
    const blockB2 = makeBlockAfter(chain, blockA1)
    const blockB3 = makeBlockAfter(chain, blockB2)
    const blockC3 = makeBlockAfter(chain, blockB2)
    const blockC4 = makeBlockAfter(chain, blockC3)
    const blockD4 = makeBlockAfter(chain, blockC3)

    const { isAdded: isAddedB3 } = await chain.addBlock(blockB3)
    const { isAdded: isAddedA2 } = await chain.addBlock(blockA2)
    const { isAdded: isAddedA1 } = await chain.addBlock(blockA1)
    const { isAdded: isAddedC3 } = await chain.addBlock(blockC3)
    const { isAdded: isAddedB2 } = await chain.addBlock(blockB2)
    const { isAdded: isAddedC4 } = await chain.addBlock(blockC4)
    const { isAdded: isAddedD4 } = await chain.addBlock(blockD4)

    expect(isAddedA1).toBe(true)
    expect(isAddedA2).toBe(true)
    expect(isAddedB2).toBe(true)
    expect(isAddedB3).toBe(true)
    expect(isAddedC3).toBe(true)
    expect(isAddedC4).toBe(true)
    expect(isAddedD4).toBe(true)

    // should be able to start at the tail
    let blocks = await AsyncUtils.materialize(chain.iterateToBlock(genesis, blockD4))
    expect(blocks.length).toBe(5)
    expect(blocks[0].hash.equals(genesis.hash)).toBe(true)
    expect(blocks[1].hash.equals(blockA1.header.hash)).toBe(true)
    expect(blocks[2].hash.equals(blockB2.header.hash)).toBe(true)
    expect(blocks[3].hash.equals(blockC3.header.hash)).toBe(true)
    expect(blocks[4].hash.equals(blockD4.header.hash)).toBe(true)

    // should be able to start at the head
    blocks = await AsyncUtils.materialize(chain.iterateToBlock(blockD4, genesis))
    expect(blocks.length).toBe(5)
    expect(blocks[0].hash.equals(blockD4.header.hash)).toBe(true)
    expect(blocks[1].hash.equals(blockC3.header.hash)).toBe(true)
    expect(blocks[2].hash.equals(blockB2.header.hash)).toBe(true)
    expect(blocks[3].hash.equals(blockA1.header.hash)).toBe(true)
    expect(blocks[4].hash.equals(genesis.hash)).toBe(true)

    // should be able to start after the tail
    blocks = await AsyncUtils.materialize(chain.iterateToBlock(blockA1, blockB3))
    expect(blocks.length).toBe(3)
    expect(blocks[0].hash.equals(blockA1.header.hash)).toBe(true)
    expect(blocks[1].hash.equals(blockB2.header.hash)).toBe(true)
    expect(blocks[2].hash.equals(blockB3.header.hash)).toBe(true)

    // If we iterate the same block, it should be yielded once
    blocks = await AsyncUtils.materialize(chain.iterateToBlock(genesis, genesis))
    expect(blocks.length).toBe(1)
    expect(blocks[0].hash.equals(genesis.hash)).toBe(true)
  })

  it('iterateToBlock errors', async () => {
    const { strategy, chain } = nodeTest
    strategy.disableMiningReward()

    await nodeTest.node.seed()
    const genesis = await chain.getGenesisHeader()
    Assert.isNotNull(genesis)

    // G -> A1 -> A2
    //   -> B1 -> B2

    const blockA1 = makeBlockAfter(chain, genesis)
    const blockA2 = makeBlockAfter(chain, blockA1)
    const blockB1 = makeBlockAfter(chain, genesis)
    const blockB2 = makeBlockAfter(chain, blockB1)

    const { isAdded: isAddedA1 } = await chain.addBlock(blockA1)
    const { isAdded: isAddedA2 } = await chain.addBlock(blockA2)
    const { isAdded: isAddedB1 } = await chain.addBlock(blockB1)
    const { isAdded: isAddedB2 } = await chain.addBlock(blockB2)

    expect(isAddedA1).toBe(true)
    expect(isAddedA2).toBe(true)
    expect(isAddedB1).toBe(true)
    expect(isAddedB2).toBe(true)

    // Cannot iterate between 2 forks when graph path happen to make it seem like
    // it can work, a few wrong blocks are yielded in this case

    // left-to-right
    let result = AsyncUtils.materialize(chain.iterateToBlock(blockA1, blockB2))
    await expect(result).rejects.toThrowError(
      'Failed to iterate between blocks on diverging forks',
    )
    // right-to-left
    result = AsyncUtils.materialize(chain.iterateToBlock(blockB2, blockA1))
    await expect(result).rejects.toThrowError(
      'Failed to iterate between blocks on diverging forks',
    )

    // Cannot iterate between 2 forks when graph path looks immediately wrong
    // because the graph path does not merge into the destination

    // left-to-right
    result = AsyncUtils.materialize(chain.iterateToBlock(blockB1, blockA2))
    await expect(result).rejects.toThrowError(
      'Start path does not match from block, are they on a fork?',
    )

    // right-to-left
    result = AsyncUtils.materialize(chain.iterateToBlock(blockA2, blockB1))
    await expect(result).rejects.toThrowError(
      'Start path does not match from block, are they on a fork?',
    )
  })

  it('iterateToHead', async () => {
    const { strategy, chain } = nodeTest
    strategy.disableMiningReward()

    // Iterate an empty chain
    let blocks = await AsyncUtils.materialize(chain.iterateToHead())
    expect(blocks.length).toBe(0)

    // Add the genesis block
    await nodeTest.node.seed()
    const genesis = await chain.getGenesisHeader()
    Assert.isNotNull(genesis)

    // Iterate with genesis block
    blocks = await AsyncUtils.materialize(chain.iterateToHead())
    expect(blocks.length).toBe(1)
    expect(blocks[0].hash.equals(genesis.hash)).toBe(true)

    // Add another block
    const block = makeBlockAfter(chain, genesis)
    await chain.addBlock(block)

    // iterate from genesis -> block
    blocks = await AsyncUtils.materialize(chain.iterateToHead())
    expect(blocks.length).toBe(2)
    expect(blocks[0].hash.equals(genesis.hash)).toBe(true)
    expect(blocks[1].hash.equals(block.header.hash)).toBe(true)
  })

  it('findFork', async () => {
    const { strategy, chain } = nodeTest
    strategy.disableMiningReward()

    await nodeTest.node.seed()
    const genesis = await chain.getGenesisHeader()
    Assert.isNotNull(genesis)

    // G -> A1 -> A2
    //         -> B2 -> B3
    //               -> C3 -> C4
    //                     -> D4

    const blockA1 = makeBlockAfter(chain, genesis)
    const blockA2 = makeBlockAfter(chain, blockA1)
    const blockB2 = makeBlockAfter(chain, blockA1)
    const blockB3 = makeBlockAfter(chain, blockB2)
    const blockC3 = makeBlockAfter(chain, blockB2)
    const blockC4 = makeBlockAfter(chain, blockC3)
    const blockD4 = makeBlockAfter(chain, blockC3)

    await addBlocksShuffle(chain, [
      blockA1,
      blockA2,
      blockB2,
      blockB3,
      blockC3,
      blockC4,
      blockD4,
    ])

    const { fork: fork1, isLinear: isLinear1 } = await chain.findFork(blockA1, blockA1)
    expect(fork1?.hash.equals(blockA1.header.hash)).toBe(true)
    expect(isLinear1).toBe(true)

    const { fork: fork2, isLinear: isLinear2 } = await chain.findFork(blockA1, blockA2)
    expect(fork2?.hash.equals(blockA1.header.hash)).toBe(true)
    expect(isLinear2).toBe(true)

    const { fork: fork3, isLinear: isLinear3 } = await chain.findFork(blockA2, blockB2)
    expect(fork3?.hash.equals(blockA1.header.hash)).toBe(true)
    expect(isLinear3).toBe(false)

    const { fork: fork4, isLinear: isLinear4 } = await chain.findFork(genesis, blockD4)
    expect(fork4?.hash.equals(genesis.hash)).toBe(true)
    expect(isLinear4).toBe(true)

    const { fork: fork5, isLinear: isLinear5 } = await chain.findFork(blockB3, blockD4)
    expect(fork5?.hash.equals(blockB2.header.hash)).toBe(true)
    expect(isLinear5).toBe(false)

    const { fork: fork6, isLinear: isLinear6 } = await chain.findFork(blockC4, blockD4)
    expect(fork6?.hash.equals(blockC3.header.hash)).toBe(true)
    expect(isLinear6).toBe(false)
  })

  it('should add notes to trees linearly', async () => {
    const { node, chain } = nodeTest
    await nodeTest.node.seed()

    const genesisNotes = await chain.notes.size()
    const genesisNullifiers = await chain.nullifiers.size()

    const account = await useAccountFixture(node.accounts, 'account')

    const block = await useBlockFixture(node.captain, async () =>
      chain.newBlock(
        [],
        await chain.strategy.createMinersFee(BigInt(0), BigInt(2), account.spendingKey),
      ),
    )

    expect(block.transactions.length).toBe(1)
    const minersFee = block.transactions[0]

    await chain.addBlock(block)
    expect(await chain.notes.size()).toBe(genesisNotes + 1)
    expect(await chain.nullifiers.size()).toBe(genesisNullifiers)

    const treeLeaf = await chain.notes.getLeaf(genesisNotes)
    const treeNote = treeLeaf.element

    minersFee.withReference(() => {
      const minersFeeNote = minersFee.getNote(0)
      expect(minersFeeNote.serialize().equals(treeNote.serialize())).toBe(true)
    })
  }, 10000)
})
