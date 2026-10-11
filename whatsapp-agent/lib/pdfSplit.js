/**
 * Biome Platform — WhatsApp Agent / merged PDF splitting
 * -------------------------------------------------------------------
 * Vendors and coordinators often send ONE PDF holding several papers:
 * weight slip + tax invoice + e-way bill + Bill T (vendor), or our tax
 * invoice + its e-way bill page. Each page is read on its own and
 * consecutive pages of the SAME document stay together (an "Original"
 * and a "Duplicate for transporter" copy of one invoice, an e-invoice
 * detail page after its invoice). Every document then goes through the
 * normal path as its own file, and all of them remember which upload
 * they came from (the bundle), so a page with nothing printed on it
 * still joins the set its siblings belong to.
 */

const { readLayout, docCore } = require("./layouts");

function identity(lay) {
  if (!lay) return null;
  return (
    lay.ourDocCore ||
    lay.vendorDocCore ||
    (lay.biomeDocNo && docCore(lay.biomeDocNo)) ||
    (lay.vendorDocNo && docCore(lay.vendorDocNo)) ||
    null
  );
}

/**
 * Decide the documents inside a multi-page PDF.
 * @param {string[]} pages  text of each page (OCR for scanned pages)
 * @returns {Array<{ pages: number[], documentType: string|null, layout: string|null }>}
 */
function segmentPages(pages, ctx = {}) {
  const read = pages.map((t) => {
    try {
      return readLayout(t, ctx);
    } catch {
      return null;
    }
  });
  const segments = [];
  for (let i = 0; i < pages.length; i++) {
    const lay = read[i];
    const prev = segments[segments.length - 1];
    if (prev && lay) {
      const pl = prev.lay;
      const sameType = pl && pl.documentType === lay.documentType;
      const sameId = identity(pl) && identity(lay) && identity(pl) === identity(lay);
      const sameEway = pl && pl.ewayBillNo && lay.ewayBillNo && pl.ewayBillNo === lay.ewayBillNo && sameType;
      const detailPage = lay.layout === "vendor_einvoice_detail" && pl && pl.documentType === "vendor_tax_invoice" && (!identity(lay) || sameId);
      if ((sameType && sameId) || sameEway || detailPage) {
        prev.pages.push(i);
        continue;
      }
    }
    segments.push({ pages: [i], lay, documentType: lay ? lay.documentType : null, layout: lay ? lay.layout : null });
  }
  return segments.map(({ pages, documentType, layout }) => ({ pages, documentType, layout }));
}

/** A new PDF holding only the given page indexes. */
async function extractPages(buffer, indexes) {
  const { loadMupdf } = require("./imageOcr");
  const mupdf = await loadMupdf();
  const src = mupdf.Document.openDocument(buffer, "application/pdf").asPDF();
  const out = new mupdf.PDFDocument();
  for (const i of indexes) out.graftPage(-1, src, i);
  return Buffer.from(out.saveToBuffer("compress").asUint8Array());
}

module.exports = { segmentPages, extractPages };
