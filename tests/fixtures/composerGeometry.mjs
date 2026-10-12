import { expect } from "@playwright/test";

export const composerViewports = [
  { width: 1440, height: 900 },
  { width: 768, height: 900 },
  { width: 320, height: 640 },
  { width: 844, height: 390 },
];

export async function composerAppearance(page, theme, layout = "focus") {
  await page.addInitScript(({ theme, layout }) => {
    localStorage.setItem("proofofwork-me-appearance-v1", theme);
    localStorage.setItem("proofofwork-me-computer-layout-v1", layout);
  }, { theme, layout });
}

// Check rendered geometry, rather than the CSS rules that are meant to produce it.
export async function expectAlignedFields(first, second, { equalWidths = false } = {}) {
  const [left, right] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  expect(left.height).toBeGreaterThanOrEqual(44);
  expect(right.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(left.height - right.height)).toBeLessThanOrEqual(1);
  if (right.x >= left.x + left.width - 1) {
    expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1);
  } else {
    expect(Math.abs(left.x - right.x)).toBeLessThanOrEqual(1);
    expect(right.y).toBeGreaterThanOrEqual(left.y + left.height + 8);
  }
  if (equalWidths) expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(1);
}

export async function expectFeePresetsContained(scope) {
  const geometry = await scope.locator(".fee-control").evaluate(element => {
    const rect = node => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return { input: rect(element.querySelector("input")), control: rect(element),
      buttons: [...element.querySelectorAll(".fee-presets button")].map(rect) };
  });
  expect(geometry.buttons).toHaveLength(4);
  for (const button of geometry.buttons) {
    expect(button.top).toBeGreaterThanOrEqual(geometry.input.bottom + 4);
    expect(button.left).toBeGreaterThanOrEqual(geometry.control.left - 1);
    expect(button.right).toBeLessThanOrEqual(geometry.control.right + 1);
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  for (let index = 1; index < geometry.buttons.length; index++) {
    const previous = geometry.buttons[index - 1];
    const current = geometry.buttons[index];
    expect(current.left >= previous.right - 1 || current.top >= previous.bottom + 4).toBe(true);
  }
}

export async function expectComposerContained(page, scope, viewport) {
  const geometry = await scope.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: element.clientWidth,
      scrollWidth: element.scrollWidth, documentWidth: document.documentElement.scrollWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
}
