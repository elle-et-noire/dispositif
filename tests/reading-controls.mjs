export async function openReadingSettings(page) {
  const settings = page.locator(".rm-settings");
  if (!(await settings.evaluate((element) => element.open))) {
    await settings.locator("summary").click();
  }
}

export async function toggleReadingMode(page) {
  if (!await page.locator(".rm-toggle").isVisible()) await openReadingSettings(page);
  await page.locator(".rm-toggle").click();
}
