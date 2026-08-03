import { expect, test, type Locator, type Page } from '@playwright/test'

const PHONE = { width: 390, height: 844 }

async function openCampaign(page: Page): Promise<void> {
  const campaign = page.getByRole('button', { name: 'Campaign: Play the house' })
  await expect(campaign).toHaveCount(1)
  await campaign.click()
  await expect(page.getByRole('heading', { name: 'Play the house' })).toBeVisible()
}

async function dragToField(page: Page, card: Locator, field: Locator): Promise<void> {
  const cardBox = await card.boundingBox()
  const fieldBox = await field.boundingBox()
  expect(cardBox).not.toBeNull()
  expect(fieldBox).not.toBeNull()
  await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(fieldBox!.x + fieldBox!.width / 2, fieldBox!.y + fieldBox!.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('[mockup] campaign, deck choice, battle entry, and card drag stay connected', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto('/?mockup')
  await openCampaign(page)

  const editDeck = page.getByRole('button', { name: /^Edit deck/ })
  await expect(editDeck).toHaveCount(1)
  await editDeck.click()
  await expect(page.locator('#app')).toHaveAttribute('data-deck-sheet', 'collapsed')

  const useDeck = page.getByRole('button', { name: 'Use this deck and return' })
  await expect(useDeck).toHaveCount(1)
  await useDeck.click()
  await expect(editDeck).toContainText('Starter')

  const startBattle = page.getByRole('button', { name: 'Start battle' })
  await expect(startBattle).toHaveCount(1)
  await startBattle.click()
  const battle = page.frameLocator('.mockup-real-battle')
  const card = battle.locator('.cc-unit-card').first()
  const field = battle.locator('#cc-drop')
  await expect(card).toBeVisible()
  await expect(field).toBeVisible()
  await dragToField(page, card, field)
  await expect(battle.locator('.cc-you .cc-stage-card')).toBeVisible()

  const back = page.getByRole('button', { name: 'Back to menu' })
  await expect(back).toHaveCount(1)
  await back.click()
  await expect(page.locator('h1')).toHaveText('Card Clash')
})

test('[live] campaign, deck selection, battle entry, and card drag stay connected', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto('/')
  await page.getByLabel('Session name').fill('RegressionPlayer')
  await openCampaign(page)

  const editDeck = page.getByRole('button', { name: /^Edit deck/ })
  await expect(editDeck).toHaveCount(1)
  await editDeck.click()
  await expect(page.locator('#app')).toHaveAttribute('data-deck-sheet', 'collapsed')
  await page.getByRole('button', { name: 'Use this deck and return' }).click()
  await expect(editDeck).toContainText('Starter')

  await page.getByRole('button', { name: 'Start battle' }).click()
  const card = page.locator('.card.pickable')
  const field = page.locator('[data-drop-target="pick"]')
  await expect(page.getByRole('heading', { name: 'Field your unit' })).toBeVisible()
  await expect(card).toHaveCount(1)
  await expect(field).toHaveCount(1)
  await expect(field).toBeVisible()
  await dragToField(page, card.first(), field)
  await expect(card.first()).toHaveClass(/locked/)
})
