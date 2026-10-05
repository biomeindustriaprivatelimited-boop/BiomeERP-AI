"""Generate realistic, degraded Biome supply documents (phone photos, WhatsApp
compression, scanned PDFs) for OCR / pipeline testing."""
import math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs"
os.makedirs(OUT, exist_ok=True)
random.seed(7); np.random.seed(7)
FD = "/usr/share/fonts/truetype/"
def F(sz, bold=False, mono=False, deva=False):
    if deva: return ImageFont.truetype(FD + "freefont/FreeSans.ttf", sz)
    if mono: return ImageFont.truetype(FD + "dejavu/DejaVuSansMono.ttf", sz)
    return ImageFont.truetype(FD + ("liberation/LiberationSans-Bold.ttf" if bold else "liberation/LiberationSans-Regular.ttf"), sz)

W, H = 1240, 1754  # A4 @150dpi

def page():
    im = Image.new("L", (W, H), 255)
    return im, ImageDraw.Draw(im)

def box(d, x0, y0, x1, y1, w=2): d.rectangle([x0, y0, x1, y1], outline=0, width=w)

def tally_invoice(title, seller, seller_addr, seller_gstin, inv_no, date, ref, cons, cons_gstin, vehicle, qty, rate, ewb, lr, hindi=False, challan=False):
    im, d = page()
    d.text((W // 2 - 90, 40), title, font=F(30, True), fill=0)
    d.text((W - 330, 48), "(ORIGINAL FOR RECIPIENT)", font=F(16), fill=0)
    if not challan:
        d.text((60, 95), "IRN : 4f1a9c2e7b3d5f8a0c6e1b9d4f7a2c5e8b0d3f6a9c2e5b8d1f4a7c0e3b6d9f2a", font=F(14), fill=0)
        d.text((60, 115), "Ack No. : 112627261988071    Ack Date : " + date, font=F(14), fill=0)
    box(d, 50, 145, 640, 330)
    d.text((62, 155), seller, font=F(20, True), fill=0)
    y = 185
    for line in seller_addr + ["GSTIN/UIN: " + seller_gstin, "State Name : Haryana, Code : 06"]:
        d.text((62, y), line, font=F(16), fill=0); y += 24
    if hindi:
        d.text((62, y), "बायोमास पेलेट्स आपूर्तिकर्ता", font=F(18, deva=True), fill=0)
    box(d, 640, 145, W - 50, 560)
    labels = [("Invoice No." if not challan else "Delivery Note No.", inv_no), ("Dated", date), ("Delivery Note", ""),
              ("Mode/Terms of Payment", "30 Days"), ("Reference No. & Date.", ""), ("Other References", ref),
              ("Buyer's Order No.", "4800012345 dt. 01-Apr-26"), ("Dispatch Doc No.", ""), ("Bill of Lading/LR-RR No.", lr),
              ("Motor Vehicle No.", vehicle), ("Dispatched through", "By Road"), ("Destination", cons[0][:28])]
    y = 152
    for lab, val in labels:
        d.text((650, y), lab, font=F(15), fill=0)
        d.text((900, y), val, font=F(17, True), fill=0)
        d.line([640, y + 30, W - 50, y + 30], fill=120, width=1)
        y += 34
    box(d, 50, 330, 640, 560)
    d.text((62, 338), "Consignee (Ship to)", font=F(14), fill=0)
    d.text((62, 358), cons[0], font=F(18, True), fill=0)
    d.text((62, 384), cons[1], font=F(15), fill=0)
    d.text((62, 406), "GSTIN/UIN : " + cons_gstin, font=F(15), fill=0)
    d.text((62, 440), "Buyer (Bill to)", font=F(14), fill=0)
    d.text((62, 460), cons[0], font=F(18, True), fill=0)
    d.text((62, 486), "GSTIN/UIN : " + cons_gstin, font=F(15), fill=0)
    # goods table
    box(d, 50, 560, W - 50, 1000)
    cols = [50, 100, 520, 650, 820, 930, 1000, W - 50]
    for x in cols[1:-1]: d.line([x, 560, x, 1000], fill=0, width=1)
    hd = ["Sl", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "per", "Amount"]
    for i, h in enumerate(hd): d.text((cols[i] + 6, 568), h, font=F(15, True), fill=0)
    d.line([50, 595, W - 50, 595], fill=0, width=1)
    amt = qty * rate * 1000
    d.text((56, 610), "1", font=F(16), fill=0)
    d.text((106, 610), "Biomass Pellets (Agro Residue)", font=F(17, True), fill=0)
    d.text((526, 610), "44013900", font=F(16), fill=0)
    d.text((656, 610), f"{qty:.3f} MT", font=F(17, True), fill=0)
    d.text((826, 610), f"{rate*1000:,.2f}", font=F(16), fill=0)
    d.text((936, 610), "MT", font=F(16), fill=0)
    d.text((1010, 610), f"{amt:,.2f}", font=F(16), fill=0)
    if not challan:
        d.text((300, 680), "CGST @ 2.5%", font=F(16), fill=0); d.text((1010, 680), f"{amt*0.025:,.2f}", font=F(16), fill=0)
        d.text((300, 706), "SGST @ 2.5%", font=F(16), fill=0); d.text((1010, 706), f"{amt*0.025:,.2f}", font=F(16), fill=0)
    d.line([50, 960, W - 50, 960], fill=0, width=1)
    tot = amt * (1.05 if not challan else 1)
    d.text((300, 968), "Total", font=F(17, True), fill=0)
    d.text((656, 968), f"{qty:.3f} MT", font=F(17, True), fill=0)
    d.text((990, 968), f"₹ {tot:,.2f}", font=F(17, True), fill=0)
    d.text((60, 1015), "Amount Chargeable (in words)", font=F(14), fill=0)
    d.text((60, 1035), "INR Six Lakh Twenty Thousand Only", font=F(16, True), fill=0)
    d.text((60, 1075), f"e-Way Bill No. : {ewb}", font=F(16), fill=0)
    d.text((60, 1100), "Company's PAN : " + seller_gstin[2:12], font=F(16), fill=0)
    if hindi:
        d.text((60, 1140), "माल प्राप्त किया - हस्ताक्षर", font=F(18, deva=True), fill=0)
    d.text((60, 1180), "Declaration: We declare that this invoice shows the actual price of the goods", font=F(14), fill=0)
    d.text((700, 1220), "for " + seller, font=F(16, True), fill=0)
    d.text((1000, 1330), "Authorised Signatory", font=F(15), fill=0)
    # round stamp
    d.ellipse([820, 1240, 990, 1400], outline=60, width=4)
    d.text((845, 1305), seller.split()[0].upper() + " • REWARI", font=F(14, True), fill=60)
    d.text((W // 2 - 140, H - 80), "This is a Computer Generated Invoice", font=F(14), fill=0)
    return im

def eway_bill(no, date, gen_by, from_name, to_name, to_gstin, vehicle, doc_no, value):
    im, d = page()
    d.text((W // 2 - 100, 40), "e-Way Bill", font=F(32, True), fill=0)
    rows = [("E-Way Bill No:", no), ("E-Way Bill Date:", date + " 10:42 AM"), ("Generated By:", gen_by + " - " + from_name),
            ("Valid Upto:", "06/10/2026"), ("Mode:", "Road"), ("Approx Distance:", "142 KM"), ("Type:", "Outward - Supply"),
            ("Document Details:", f"Tax Invoice - {doc_no} - {date}"), ("Transaction type:", "Regular")]
    y = 120
    d.text((60, y), "Part - A", font=F(20, True), fill=0); y += 40
    for a, b in rows:
        d.text((60, y), a, font=F(17), fill=0); d.text((360, y), b, font=F(17, True), fill=0); y += 34
    y += 10
    d.text((60, y), "GSTIN of Supplier   " + gen_by, font=F(16), fill=0); y += 28
    d.text((60, y), "Place of Dispatch   Rewari, HARYANA - 123401", font=F(16), fill=0); y += 28
    d.text((60, y), "GSTIN of Recipient  " + to_gstin + "  " + to_name, font=F(16), fill=0); y += 28
    d.text((60, y), "Place of Delivery   Jhajjar, HARYANA - 124103", font=F(16), fill=0); y += 28
    d.text((60, y), "Value of Goods      " + value, font=F(16), fill=0); y += 28
    d.text((60, y), "HSN Code            44013900 - Biomass pellets", font=F(16), fill=0); y += 40
    d.text((60, y), "Part - B", font=F(20, True), fill=0); y += 40
    box(d, 50, y, W - 50, y + 90)
    for i, h in enumerate(["Mode", "Vehicle / Trans Doc No & Dt.", "From", "Entered Date", "Entered By"]):
        d.text((60 + i * 230, y + 8), h, font=F(14, True), fill=0)
    for i, h in enumerate(["Road", vehicle, "Rewari", date, gen_by]):
        d.text((60 + i * 230, y + 48), h, font=F(16), fill=0)
    # barcode
    x = 300
    for i in range(160):
        wbar = random.choice([2, 3, 4]);
        if i % 2 == 0: d.rectangle([x, y + 140, x + wbar, y + 230], fill=0)
        x += wbar
    return im

def weight_slip(hindi=True):
    im = Image.new("L", (900, 1100), 250); d = ImageDraw.Draw(im)
    mono = F(22, mono=True)
    y = 40
    if hindi:
        d.text((150, y), "श्री बालाजी धर्म कांटा", font=F(34, deva=True), fill=20); y += 50
    d.text((150, y), "SHREE BALAJI DHARAM KANTA", font=F(28, True), fill=20); y += 40
    d.text((150, y), "Rewari Road, Mayan (Haryana)  Mob 9812345670", font=F(18), fill=20); y += 60
    lines = ["Slip No.   : 4471", "Date       : 03/10/2026", "Vehicle No : HR55AB1234", "Party      : BIOME INDUSTRIA PVT LTD",
             "Material   : BIOMASS PELLET", "", "Gross Wt.  : 41,260 Kg   14:05", "Tare Wt.   : 11,420 Kg   12:51",
             "Net Wt.    : 29,840 Kg", "", "Charges    : Rs 100/-", "Operator   : Ramesh"]
    for l in lines:
        d.text((90, y), l, font=mono, fill=30); y += 42
    if hindi:
        d.text((90, y + 20), "कुल वजन / शुद्ध वजन", font=F(24, deva=True), fill=30)
    # dot matrix look: erode random dots
    a = np.array(im).astype(np.int16)
    mask = (a < 128) & (np.random.rand(*a.shape) < 0.25)
    a[mask] = 200
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))

def handwritten_challan():
    im, d = page()
    d.text((W // 2 - 160, 50), "DELIVERY CHALLAN", font=F(34, True), fill=0)
    d.text((W // 2 - 220, 100), "AMBIKA AGRO TRADERS", font=F(30, True), fill=0)
    d.text((W // 2 - 260, 140), "VPO Kosli, Distt. Rewari (HR)  GSTIN: 06ABCPA1234M1Z5", font=F(16), fill=0)
    fields = [("Challan No.", "338"), ("Date", "03/10/26"), ("To M/s", "Biome Industria Pvt Ltd"), ("GSTIN", "06AAJCB1927H1ZS"),
              ("Vehicle No.", "HR 55 AB 1234"), ("Material", "Paddy Straw Pellets"), ("Quantity", "29.840 MT"), ("Driver Mob.", "9876543210")]
    y = 220
    hand = F(30, bold=False)
    for a, b in fields:
        d.text((90, y), a, font=F(20, True), fill=0); d.line([300, y + 30, 1100, y + 30], fill=0, width=1)
        # "handwriting": jittered characters
        x = 320
        for ch in b:
            d.text((x, y - 4 + random.randint(-3, 3)), ch, font=hand, fill=random.randint(10, 60)); x += hand.getlength(ch) + random.randint(0, 3)
        y += 70
    d.text((90, y + 60), "Receiver's Signature", font=F(18), fill=0)
    d.text((850, y + 60), "For Ambika Agro Traders", font=F(18), fill=0)
    return im

# ---------------------------------------------------------- degradations
def phone_photo(im, angle=4.0, persp=0.04, long_side=1280, q=55, dark=0.45, blur=1.0, rot90=0, bg=(70, 60, 50)):
    im = im.convert("RGB")
    # paper tint
    arr = np.array(im).astype(np.float32)
    arr = arr * np.array([0.97, 0.95, 0.90])
    im = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    w, h = im.size
    pad = int(max(w, h) * 0.12)
    canvas = Image.new("RGB", (w + 2 * pad, h + 2 * pad), bg)
    canvas.paste(im, (pad, pad))
    canvas = canvas.rotate(angle, resample=Image.BICUBIC, fillcolor=bg)
    # perspective
    cw, ch = canvas.size
    dx, dy = persp * cw, persp * ch
    src = [(0, 0), (cw, 0), (cw, ch), (0, ch)]
    dst = [(dx, dy * 0.5), (cw - dx * 0.3, 0), (cw, ch), (0, ch - dy)]
    coeffs = find_coeffs(dst, src)
    canvas = canvas.transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=bg)
    # uneven lighting: gradient + vignette
    yy, xx = np.mgrid[0:ch, 0:cw].astype(np.float32)
    g = 1 - dark * (xx / cw) * (yy / ch) - 0.15 * (((xx - cw / 2) / cw) ** 2 + ((yy - ch / 2) / ch) ** 2) * 4
    a = np.array(canvas).astype(np.float32) * g[..., None]
    a += np.random.normal(0, 6, a.shape)
    canvas = Image.fromarray(a.clip(0, 255).astype(np.uint8))
    if blur: canvas = canvas.filter(ImageFilter.GaussianBlur(blur))
    if rot90: canvas = canvas.rotate(rot90, expand=True)
    s = long_side / max(canvas.size)
    canvas = canvas.resize((int(canvas.size[0] * s), int(canvas.size[1] * s)), Image.LANCZOS)
    return canvas, q

def find_coeffs(pa, pb):
    m = []
    for p1, p2 in zip(pa, pb):
        m.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        m.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    A = np.matrix(m, dtype=float); B = np.array(pb).reshape(8)
    return np.array(np.dot(np.linalg.inv(A.T * A) * A.T, B)).reshape(8)

def save_jpg(name, im_q):
    im, q = im_q
    p = os.path.join(OUT, name); im.save(p, "JPEG", quality=q); return p

def save_scan_pdf(name, im, angle=1.5):
    im = im.convert("L").rotate(angle, resample=Image.BICUBIC, fillcolor=235)
    a = np.array(im).astype(np.float32) * 0.93 + 10 + np.random.normal(0, 8, im.size[::-1])
    im = Image.fromarray(a.clip(0, 255).astype(np.uint8)).resize((int(im.size[0] * 0.8), int(im.size[1] * 0.8)))
    p = os.path.join(OUT, name); im.save(p, "PDF", resolution=120); return p

biome = "BIOME INDUSTRIA PRIVATE LIMITED"
addr = ["Plot 14, Village Mayan, Rewari Road", "Distt. Rewari, Haryana - 123401"]
jpl = ("JHAJJAR POWER LIMITED", "Village Khanpur, Distt. Jhajjar (HR)")
inv = tally_invoice("Tax Invoice", biome, addr, "06AAJCB1927H1ZS", "BI26-27-HR0912", "03-Oct-26", "BDC/912/AAT/338",
                    jpl, "06AABCJ5678K1Z2", "HR55AB1234", 29.84, 2.95, "3412 5566 7788", "LR 7781 dt 03-Oct-26", hindi=True)
dc = tally_invoice("Delivery Challan", biome, addr, "06AAJCB1927H1ZS", "BIPL/2026-27/913", "03-Oct-26", "BDC/913/AAT/339",
                   jpl, "06AABCJ5678K1Z2", "HR55AC4321", 30.12, 2.95, "3412 5566 7799", "", challan=True)
vinv = tally_invoice("Tax Invoice", "AMBIKA AGRO TRADERS", ["VPO Kosli, Distt. Rewari", "Haryana - 123302"], "06ABCPA1234M1Z5", "338", "03-Oct-26", "",
                     ("BIOME INDUSTRIA PRIVATE LIMITED", "Village Mayan, Rewari (HR)"), "06AAJCB1927H1ZS", "HR55AB1234", 29.84, 2.55, "3412 5566 1100", "")
ewb = eway_bill("3412 5566 7788", "03/10/2026", "06AAJCB1927H1ZS", biome, "JHAJJAR POWER LIMITED", "06AABCJ5678K1Z2", "HR55AB1234", "BI26-27-HR0912", "6,19,868.40")
ws = weight_slip()
hc = handwritten_challan()

made = []
made.append(save_jpg("01_biome_invoice_phone_wa1280.jpg", phone_photo(inv, angle=5, long_side=1280, q=55)))
made.append(save_jpg("02_biome_invoice_phone_wa1000_dark.jpg", phone_photo(inv, angle=-3, long_side=1000, q=45, dark=0.6, blur=1.3)))
made.append(save_jpg("03_biome_invoice_sideways.jpg", phone_photo(inv, angle=2, long_side=1280, q=60, rot90=90)))
made.append(save_jpg("04_biome_challan_upsidedown.jpg", phone_photo(dc, angle=-2, long_side=1280, q=60, rot90=180)))
made.append(save_jpg("05_vendor_invoice_phone.jpg", phone_photo(vinv, angle=7, persp=0.06, long_side=1280, q=55)))
made.append(save_jpg("06_eway_bill_phone.jpg", phone_photo(ewb, angle=-4, long_side=1200, q=50)))
made.append(save_jpg("07_weight_slip_hindi.jpg", phone_photo(ws, angle=6, long_side=1000, q=50, dark=0.5)))
made.append(save_jpg("08_vendor_challan_handwritten.jpg", phone_photo(hc, angle=-5, long_side=1280, q=55)))
big, _ = phone_photo(inv, angle=3, long_side=4000, q=85, blur=1.6)
made.append(save_jpg("09_biome_invoice_big_4000.jpg", (big, 85)))
made.append(save_scan_pdf("10_vendor_invoice_scan.pdf", vinv))
made.append(save_scan_pdf("11_biome_challan_scan.pdf", dc, angle=-2))
made.append(save_scan_pdf("12_weight_slip_scan.pdf", ws, angle=3))
print("\n".join(made))
