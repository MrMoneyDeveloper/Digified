"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const templates = [
  "templates/custom_pages/room_booking.hbs",
  "templates/custom_pages/training_booking.hbs"
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function matchingDivEnd(source, id) {
  const idIndex = source.indexOf(`id="${id}"`);
  assert.ok(idIndex >= 0, `${id} must exist`);

  const openIndex = source.lastIndexOf("<div", idIndex);
  assert.ok(openIndex >= 0, `${id} must be on a div`);

  const divToken = /<div\b[^>]*>|<\/div>/gi;
  divToken.lastIndex = openIndex;
  let depth = 0;
  let match;

  while ((match = divToken.exec(source))) {
    if (/^<\/div/i.test(match[0])) {
      depth -= 1;
      if (depth === 0) return divToken.lastIndex;
    } else {
      depth += 1;
    }
  }

  throw new Error(`Could not find closing div for ${id}`);
}

templates.forEach((relativePath) => {
  const source = read(relativePath);
  const rootEnd = matchingDivEnd(source, "training-booking-root");
  const modalIndex = source.indexOf('id="training-booking-modal"');
  const signedOutIndex = source.indexOf("{{else}}", rootEnd);

  assert.ok(modalIndex > rootEnd, `${relativePath}: modal must be outside .tb-app container root`);
  assert.ok(signedOutIndex > modalIndex, `${relativePath}: modal must remain inside the signed-in branch`);
  assert.ok(source.includes('class="tb-modal"'), `${relativePath}: modal class must be preserved`);
  assert.ok(source.includes('aria-modal="true"'), `${relativePath}: dialog semantics must be preserved`);
});

console.log("booking modal viewport contract tests passed");
