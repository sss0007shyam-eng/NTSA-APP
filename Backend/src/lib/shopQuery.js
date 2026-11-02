// Turns a shopper's plain sentence ("mujhe white jute lene hain aur 1500 ka
// mera budget hai") into the filters the catalog can actually be queried
// with: a colour, a price range, an item type and whatever words are left.
//
// Why a parser and not a language model: for this one job the parser is the
// better tool, not just the cheaper one. It answers in microseconds, costs
// nothing, gives the same answer twice, and -- because every product it shows
// comes out of a real database query -- it cannot invent a product we do not
// sell. A model's only real advantage here is understanding sentences the
// lexicon has never seen, so `interpretQuery()` at the bottom of this file is
// the one place a model would ever be called; nothing else changes.

// What the shopper might call a colour, mapped onto the colour words sellers
// actually type into the catalog. Hindi spellings vary a lot, so the common
// romanisations are all listed rather than guessed at.
export const COLOR_WORDS = {
  white: 'White', safed: 'White', sufaid: 'White', safeid: 'White',
  black: 'Black', kala: 'Black', kaala: 'Black', kali: 'Black',
  red: 'Red', lal: 'Red', laal: 'Red',
  blue: 'Blue', neela: 'Blue', nila: 'Blue', neeli: 'Blue',
  green: 'Green', hara: 'Green', hari: 'Green',
  yellow: 'Yellow', peela: 'Yellow', pila: 'Yellow',
  pink: 'Pink', gulabi: 'Pink',
  grey: 'Grey', gray: 'Grey', saleti: 'Grey', sleti: 'Grey',
  brown: 'Brown', bhura: 'Brown',
  purple: 'Purple', jamuni: 'Purple', baingani: 'Purple',
  orange: 'Orange', narangi: 'Orange',
  gold: 'Gold', golden: 'Gold', sona: 'Gold', sunehra: 'Gold',
  silver: 'Silver', chandi: 'Silver',
  navy: 'Navy', beige: 'Beige', maroon: 'Maroon', cream: 'Cream',
};

// What the shopper might call the thing itself. `label` is what we show back
// to them ("Shoes"), `terms` are searched against product names and
// descriptions, and `category` is the seeded category to fall back on when
// no name matches. A phrase with a space in it is matched as a phrase.
export const ITEM_WORDS = {
  // Footwear -- the client's own example. "jute" is shoes, not the fabric.
  jute: { label: 'Shoes', terms: ['shoe', 'footwear', 'sneaker'] },
  joote: { label: 'Shoes', terms: ['shoe', 'footwear', 'sneaker'] },
  jutte: { label: 'Shoes', terms: ['shoe', 'footwear', 'sneaker'] },
  juta: { label: 'Shoes', terms: ['shoe', 'footwear', 'sneaker'] },
  jutti: { label: 'Shoes', terms: ['shoe', 'footwear', 'sandal'] },
  shoe: { label: 'Shoes', terms: ['shoe', 'footwear', 'sneaker'] },
  shoes: { label: 'Shoes', terms: ['shoe', 'footwear', 'sneaker'] },
  sneakers: { label: 'Shoes', terms: ['sneaker', 'shoe'] },
  footwear: { label: 'Footwear', terms: ['shoe', 'footwear', 'sandal', 'slipper'] },
  chappal: { label: 'Slippers', terms: ['slipper', 'sandal', 'flip'] },
  sandal: { label: 'Sandals', terms: ['sandal', 'slipper'] },
  // Clothing
  kapde: { label: 'Clothing', terms: ['shirt', 'tshirt', 'kurta', 'jeans', 'dress'], category: 'Fashion' },
  kapda: { label: 'Clothing', terms: ['shirt', 'tshirt', 'kurta', 'jeans', 'dress'], category: 'Fashion' },
  clothes: { label: 'Clothing', terms: ['shirt', 'tshirt', 'kurta', 'jeans', 'dress'], category: 'Fashion' },
  clothing: { label: 'Clothing', terms: ['shirt', 'tshirt', 'kurta', 'jeans', 'dress'], category: 'Fashion' },
  shirt: { label: 'Shirt', terms: ['shirt'], category: 'Fashion' },
  tshirt: { label: 'T-shirt', terms: ['tshirt', 't-shirt', 'tee'], category: 'Fashion' },
  kurta: { label: 'Kurta', terms: ['kurta'], category: 'Fashion' },
  saree: { label: 'Saree', terms: ['saree', 'sari'], category: 'Fashion' },
  jeans: { label: 'Jeans', terms: ['jeans', 'denim'], category: 'Fashion' },
  // Phones and electronics
  mobile: { label: 'Mobile', terms: ['phone', 'mobile', 'smartphone'], category: 'Mobiles' },
  phone: { label: 'Mobile', terms: ['phone', 'mobile', 'smartphone'], category: 'Mobiles' },
  smartphone: { label: 'Mobile', terms: ['phone', 'mobile', 'smartphone'], category: 'Mobiles' },
  laptop: { label: 'Laptop', terms: ['laptop', 'notebook'], category: 'Electronics' },
  computer: { label: 'Computer', terms: ['computer', 'desktop', 'laptop'], category: 'Electronics' },
  headphone: { label: 'Headphones', terms: ['headphone', 'earphone', 'headset', 'earbud'] },
  headphones: { label: 'Headphones', terms: ['headphone', 'earphone', 'headset', 'earbud'] },
  earphones: { label: 'Earphones', terms: ['earphone', 'headphone', 'earbud'] },
  earbuds: { label: 'Earbuds', terms: ['earbud', 'earphone', 'headphone'] },
  speaker: { label: 'Speaker', terms: ['speaker'] },
  // Watches and bags
  ghadi: { label: 'Watch', terms: ['watch', 'clock'] },
  ghari: { label: 'Watch', terms: ['watch', 'clock'] },
  watch: { label: 'Watch', terms: ['watch'] },
  bag: { label: 'Bag', terms: ['bag', 'backpack'] },
  bags: { label: 'Bag', terms: ['bag', 'backpack'] },
  basta: { label: 'Bag', terms: ['bag', 'backpack'] },
  jhola: { label: 'Bag', terms: ['bag', 'backpack'] },
  backpack: { label: 'Backpack', terms: ['backpack', 'bag'] },
  purse: { label: 'Purse', terms: ['purse', 'wallet', 'bag'] },
  // Home, kitchen, appliances, furniture
  mug: { label: 'Mug', terms: ['mug', 'cup'] },
  cup: { label: 'Cup', terms: ['cup', 'mug'] },
  kitchen: { label: 'Kitchen', terms: [], category: 'Home & Kitchen' },
  rasoi: { label: 'Kitchen', terms: [], category: 'Home & Kitchen' },
  fridge: { label: 'Fridge', terms: ['fridge', 'refrigerator'], category: 'Appliances' },
  'washing machine': { label: 'Washing machine', terms: ['washing machine', 'washer'], category: 'Appliances' },
  'air fryer': { label: 'Air fryer', terms: ['air fryer', 'fryer'], category: 'Appliances' },
  mixer: { label: 'Mixer', terms: ['mixer', 'grinder'], category: 'Appliances' },
  sofa: { label: 'Sofa', terms: ['sofa', 'couch'], category: 'Furniture' },
  kursi: { label: 'Chair', terms: ['chair', 'stool'], category: 'Furniture' },
  chair: { label: 'Chair', terms: ['chair', 'stool'], category: 'Furniture' },
  table: { label: 'Table', terms: ['table', 'desk'], category: 'Furniture' },
  mez: { label: 'Table', terms: ['table', 'desk'], category: 'Furniture' },
  palang: { label: 'Bed', terms: ['bed'], category: 'Furniture' },
  bed: { label: 'Bed', terms: ['bed'], category: 'Furniture' },
  furniture: { label: 'Furniture', terms: [], category: 'Furniture' },
  // Books, toys, grocery, beauty, health, sports, garden, loans
  kitab: { label: 'Books', terms: ['book', 'novel'], category: 'Books' },
  kitaab: { label: 'Books', terms: ['book', 'novel'], category: 'Books' },
  book: { label: 'Books', terms: ['book', 'novel'], category: 'Books' },
  books: { label: 'Books', terms: ['book', 'novel'], category: 'Books' },
  khilona: { label: 'Toys', terms: ['toy', 'game'], category: 'Toys & Games' },
  khilone: { label: 'Toys', terms: ['toy', 'game'], category: 'Toys & Games' },
  toy: { label: 'Toys', terms: ['toy', 'game'], category: 'Toys & Games' },
  toys: { label: 'Toys', terms: ['toy', 'game'], category: 'Toys & Games' },
  grocery: { label: 'Grocery', terms: ['grocery'], category: 'Grocery' },
  kirana: { label: 'Grocery', terms: ['grocery'], category: 'Grocery' },
  rashan: { label: 'Grocery', terms: ['grocery'], category: 'Grocery' },
  ration: { label: 'Grocery', terms: ['grocery'], category: 'Grocery' },
  sabzi: { label: 'Grocery', terms: ['vegetable', 'grocery'], category: 'Grocery' },
  makeup: { label: 'Beauty', terms: ['makeup', 'cream', 'lipstick'], category: 'Beauty' },
  shampoo: { label: 'Shampoo', terms: ['shampoo'], category: 'Beauty' },
  beauty: { label: 'Beauty', terms: [], category: 'Beauty' },
  dawa: { label: 'Health', terms: [], category: 'Health' },
  medicine: { label: 'Health', terms: ['medicine'], category: 'Health' },
  health: { label: 'Health', terms: [], category: 'Health' },
  sports: { label: 'Sports', terms: [], category: 'Sports' },
  khel: { label: 'Sports', terms: [], category: 'Sports' },
  cricket: { label: 'Cricket', terms: ['cricket', 'bat', 'ball'], category: 'Sports' },
  gym: { label: 'Fitness', terms: ['gym', 'fitness', 'dumbbell'], category: 'Sports' },
  garden: { label: 'Garden', terms: ['garden', 'plant'], category: 'Lawn & Garden' },
  bagicha: { label: 'Garden', terms: ['garden', 'plant'], category: 'Lawn & Garden' },
  paudha: { label: 'Plants', terms: ['plant', 'garden'], category: 'Lawn & Garden' },
  loan: { label: 'Loans', terms: ['loan'], category: 'Loans' },
  karza: { label: 'Loans', terms: ['loan'], category: 'Loans' },
  udhaar: { label: 'Loans', terms: ['loan'], category: 'Loans' },
};

// "2 hazaar", "1.5k", "do hazaar" and "ek lakh" all mean a plain number once
// the scale word is folded in, which is what every price pattern below reads.
const NUMERALS = {
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const SCALES = {
  k: 1000, hazaar: 1000, hazar: 1000, hajaar: 1000, hajar: 1000, hazzar: 1000, thousand: 1000,
  sau: 100, hundred: 100, lakh: 100000, lakhs: 100000, lac: 100000, crore: 10000000,
};

// Words that carry no meaning for a catalog search, so they never end up as
// a leftover keyword. Hindi fillers are in here with the English ones.
const STOP_WORDS = new Set([
  'i', 'a', 'an', 'the', 'me', 'my', 'mine', 'we', 'us', 'you', 'your', 'it', 'its', 'is', 'am', 'are', 'was', 'be',
  'need', 'needs', 'needed', 'want', 'wants', 'wanted', 'show', 'showing', 'find', 'finding', 'looking', 'look',
  'for', 'some', 'any', 'please', 'pls', 'plz', 'get', 'buy', 'buying', 'have', 'has', 'had', 'with', 'and', 'or',
  'to', 'of', 'in', 'on', 'at', 'can', 'could', 'would', 'do', 'does', 'there', 'that', 'this', 'these', 'those',
  'good', 'nice', 'new', 'item', 'items', 'product', 'products', 'something', 'anything', 'suggest', 'recommend',
  'mujhe', 'mujhko', 'hamein', 'hame', 'humein', 'mera', 'meri', 'mere', 'chahiye', 'chahie', 'chaahiye', 'lene',
  'lena', 'leni', 'hain', 'hai', 'hoon', 'ho', 'ka', 'ki', 'ke', 'ko', 'se', 'par', 'aur', 'ya', 'ek', 'kuch',
  'dikhao', 'dikha', 'dikhaao', 'batao', 'de', 'do', 'dedo', 'wala', 'wali', 'wale', 'bhai', 'yaar', 'koi', 'kya',
  'jo', 'bhi', 'to', 'toh', 'na', 'nahi', 'acha', 'accha', 'sasta', 'sundar',
]);

// Words that only ever describe a price or a colour, not the thing itself.
const FILTER_WORDS = new Set([
  'rs', 'rs.', 'rupee', 'rupees', 'rupay', 'rupaye', 'rupaiya', 'inr', 'price', 'prices', 'cost', 'daam', 'keemat',
  'budget', 'bajat', 'under', 'below', 'less', 'lower', 'than', 'within', 'upto', 'max', 'maximum', 'most',
  'above', 'over', 'more', 'min', 'minimum', 'least', 'between', 'beech', 'bich', 'range',
  'kam', 'andar', 'niche', 'neeche', 'tak', 'upar', 'zyada', 'jyada', 'adhik',
  'cheap', 'cheaper', 'cheapest', 'costly', 'mehnga', 'mehanga', 'expensive', 'premium',
  'best', 'top', 'popular', 'rated', 'rating', 'lowest', 'highest',
  'color', 'colour', 'colors', 'colours', 'rang', 'rangeen', 'size', 'sizes',
]);

/** "1500" -> "₹1,500", with Indian digit grouping. */
export function formatRupees(amount) {
  const digits = String(Math.round(amount));
  if (digits.length <= 3) return `₹${digits}`;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${head},${digits.slice(-3)}`;
}

const ALT = words => words.map(w => w.replace(/[.\\+*?[\]^$(){}|]/g, '\\$&')).join('|');

// Folds "2 hazaar" / "1.5k" / "do hazaar" into the number they mean, so one
// set of price patterns handles every way an Indian shopper states an amount.
function expandAmounts(text) {
  const pattern = new RegExp(`\\b(\\d+(?:\\.\\d+)?|${ALT(Object.keys(NUMERALS))})\\s*(${ALT(Object.keys(SCALES))})\\b`, 'g');
  return text.replace(pattern, (whole, n, scale) => {
    const base = NUMERALS[n] ?? Number(n);
    return Number.isFinite(base) ? String(Math.round(base * SCALES[scale])) : whole;
  });
}

const CURRENCY = '(?:₹|rs\\.?|inr|rupees?|rupaye?|rupaiya)?';
const AMOUNT = '(\\d{1,9})';
// Tried in order, first hit wins. A range has to be tried before the single
// bounds, or "500 se 1500 ke beech" would be read as just "1500".
const PRICE_RULES = [
  // 500 se 1500 ke beech / between 500 and 1500 / 500-1500
  { re: new RegExp(`${CURRENCY}\\s*${AMOUNT}\\s*${CURRENCY}\\s*(?:-|–|to|se|and|aur)\\s*${CURRENCY}\\s*${AMOUNT}`), read: m => ({ min: Math.min(+m[1], +m[2]), max: Math.max(+m[1], +m[2]) }) },
  // under 2000 / upto 2000 / 2000 se kam
  { re: new RegExp(`(?:under|below|less than|lower than|within|upto|up to|max|maximum|at most|se kam|se niche|se neeche)\\s*${CURRENCY}\\s*${AMOUNT}`), read: m => ({ max: +m[1] }) },
  // ₹1500 tak / 1500 ke andar / 1500 se kam / 1500 or less
  { re: new RegExp(`${CURRENCY}\\s*${AMOUNT}\\s*${CURRENCY}\\s*(?:ke |se )?(?:tak|andar|kam|niche|neeche|under|or less|or below|ke bhitar)`), read: m => ({ max: +m[1] }) },
  // above 500 / 500 se zyada
  { re: new RegExp(`(?:above|over|more than|minimum|min|at least|se upar|se zyada|se jyada|se adhik)\\s*${CURRENCY}\\s*${AMOUNT}`), read: m => ({ min: +m[1] }) },
  { re: new RegExp(`${CURRENCY}\\s*${AMOUNT}\\s*${CURRENCY}\\s*(?:se |ke )?(?:upar|zyada|jyada|adhik|or more|plus)`), read: m => ({ min: +m[1] }) },
  // "1500 ka mera budget hai" -- the commonest way it is actually typed.
  // Floored, so a size or a model number ("size 8 ka") is not read as money.
  { re: new RegExp(`${CURRENCY}\\s*${AMOUNT}\\s*(?:ka|ki|ke)\\b`), read: m => ({ max: +m[1] }), floor: 10 },
  { re: new RegExp(`(?:₹|rs\\.?|inr)\\s*${AMOUNT}`), read: m => ({ max: +m[1] }) },
  { re: new RegExp(`${AMOUNT}\\s*(?:rupees?|rupaye?|rupaiya|rs\\b)`), read: m => ({ max: +m[1] }) },
];
// A number with nothing at all marking it as money is only read as a budget
// when it is big enough to be one -- so "iphone 13" and "size 8" stay as
// part of what the shopper is looking for.
const BARE_AMOUNT_FLOOR = 50;
const BARE = new RegExp(`\\b${AMOUNT}\\b`);

function readPrice(text) {
  for (const rule of PRICE_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const found = rule.read(m);
    if (Math.min(found.min ?? Infinity, found.max ?? Infinity) < (rule.floor ?? 1)) continue;
    return { ...found, span: [m.index, m.index + m[0].length] };
  }
  // "budget 1500" / "mera bajat 2 hazaar": the word is itself a ceiling,
  // wherever in the sentence the number happens to sit.
  const bare = BARE.exec(text);
  if (!bare) return {};
  const span = [bare.index, bare.index + bare[0].length];
  if (/\b(budget|bajat)\b/.test(text)) return { max: +bare[1], span };
  return +bare[1] >= BARE_AMOUNT_FLOOR ? { max: +bare[1], span } : {};
}

/**
 * Reads a shopper's sentence into catalog filters.
 * `categories` is the live category list, so an item word only resolves to a
 * category that actually exists in this database.
 */
export function parseShopQuery(sentence, categories = []) {
  const text = expandAmounts(String(sentence ?? '').toLowerCase().replace(/(\d),(\d{3})\b/g, '$1$2'));
  const price = readPrice(text);
  // Blank out the price phrase so none of its digits or words survive as a
  // keyword ("1500" must not be searched for in product names).
  const rest = price.span ? `${text.slice(0, price.span[0])} ${text.slice(price.span[1])}` : text;

  let color = null;
  let item = null;
  // Phrases first ("washing machine" before "machine"), then single words.
  const phrases = Object.keys(ITEM_WORDS).filter(k => k.includes(' ')).sort((a, b) => b.length - a.length);
  let stripped = rest;
  for (const phrase of phrases) {
    const re = new RegExp(`\\b${phrase}\\b`);
    if (re.test(stripped)) {
      item = { word: phrase, ...ITEM_WORDS[phrase] };
      stripped = stripped.replace(re, ' ');
      break;
    }
  }
  const tokens = stripped.split(/[^a-z0-9]+/).filter(Boolean);
  const keywords = [];
  for (const token of tokens) {
    if (!color && COLOR_WORDS[token]) { color = COLOR_WORDS[token]; continue; }
    if (!item && ITEM_WORDS[token]) { item = { word: token, ...ITEM_WORDS[token] }; continue; }
    if (COLOR_WORDS[token] || ITEM_WORDS[token] || STOP_WORDS.has(token) || FILTER_WORDS.has(token)) continue;
    if (token.length < 2 || /^\d+$/.test(token)) continue;
    if (!keywords.includes(token)) keywords.push(token);
  }

  let sort = null;
  if (/\b(cheap|cheapest|sasta|lowest|kam daam)\b/.test(text)) sort = 'price_asc';
  else if (/\b(costly|mehnga|mehanga|expensive|premium|highest)\b/.test(text)) sort = 'price_desc';
  else if (/\b(best|top|popular|rated|rating)\b/.test(text)) sort = 'rating';

  const category = item?.category ? categories.find(c => c.name === item.category) ?? null : null;
  return {
    color,
    item: item ? { label: item.label, terms: item.terms } : null,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    minRupees: price.min ?? null,
    maxRupees: price.max ?? null,
    keywords,
    sort,
  };
}

/** Everything worth matching against a product's name or description. */
export function searchTerms(parsed) {
  return [...new Set([...(parsed.item?.terms ?? []), ...parsed.keywords])];
}

/**
 * How the parse reads back to the shopper, e.g. "White · Shoes · under ₹1,500".
 * Shown so a wrong guess is visible and can be retyped, rather than silently
 * returning the wrong shelf.
 */
export function describeQuery(parsed) {
  const bits = [];
  if (parsed.color) bits.push(parsed.color);
  if (parsed.item) bits.push(parsed.item.label);
  else if (parsed.categoryName) bits.push(parsed.categoryName);
  bits.push(...parsed.keywords);
  if (parsed.minRupees != null && parsed.maxRupees != null) bits.push(`${formatRupees(parsed.minRupees)}–${formatRupees(parsed.maxRupees)}`);
  else if (parsed.maxRupees != null) bits.push(`under ${formatRupees(parsed.maxRupees)}`);
  else if (parsed.minRupees != null) bits.push(`above ${formatRupees(parsed.minRupees)}`);
  return bits.join(' · ');
}

/**
 * Whether a product can be had in `color`. The catalog keeps colours as the
 * seller typed them, and some products name the colour only in the title or
 * in a spec row, so all three are checked.
 */
export function matchesColor(product, color) {
  const want = color.toLowerCase();
  const attributes = Array.isArray(product.attributes) ? product.attributes : [];
  return (product.colors ?? []).some(c => String(c).toLowerCase().includes(want)) ||
    String(product.name ?? '').toLowerCase().includes(want) ||
    attributes.some(a => String(a?.value ?? '').toLowerCase().includes(want));
}

// How well a candidate answers the sentence. A term in the name counts for
// much more than the same term buried in the description, which is boilerplate
// on most of this catalog.
function scoreFor(product, parsed) {
  const name = String(product.name ?? '').toLowerCase();
  const description = String(product.description ?? '').toLowerCase();
  let score = 0;
  for (const term of parsed.item?.terms ?? []) {
    if (name.includes(term)) score += 4;
    else if (description.includes(term)) score += 1;
  }
  for (const word of parsed.keywords) {
    if (name.includes(word)) score += 3;
    else if (description.includes(word)) score += 1;
  }
  if (parsed.categoryId && product.categoryId === parsed.categoryId) score += 2;
  if (parsed.color && matchesColor(product, parsed.color)) score += 2;
  return score;
}

const inRange = (product, { minRupees, maxRupees }) =>
  (minRupees == null || product.pricePaise >= minRupees * 100) &&
  (maxRupees == null || product.pricePaise <= maxRupees * 100);

// In stock first -- an out-of-stock match is a dead end for the shopper --
// then the best answer to the sentence, then whatever the admin has ranked up.
function byRelevance(parsed) {
  return (a, b) => (b.stock > 0) - (a.stock > 0) || scoreFor(b, parsed) - scoreFor(a, parsed) ||
    (b.featuredRank ?? 0) - (a.featuredRank ?? 0) || a.pricePaise - b.pricePaise;
}
// For results we are only showing because the budget had to be lifted: the
// cheapest ones first, so "just over budget" really is what shows up first.
function byPrice(parsed) {
  return (a, b) => (b.stock > 0) - (a.stock > 0) || a.pricePaise - b.pricePaise || scoreFor(b, parsed) - scoreFor(a, parsed);
}

/**
 * Picks what to show from the candidates, loosening one constraint at a time
 * rather than ever handing back an unexplained empty screen. `relaxed` says
 * which constraint had to go, so the shopper is told.
 */
export function pickResults(candidates, parsed, limit = 12) {
  // Someone asking for shoes does not want a mug, however white and cheap it
  // is, so a named thing filters as hard as the colour and the budget do --
  // scoring it only into first place still leaves the rest of the catalog
  // padding the screen. The fallbacks below start from everything again, so a
  // word nothing answers still ends up showing something, with `relaxed` set.
  const onTopic = parsed.item || parsed.keywords.length
    ? candidates.filter(p => scoreFor(p, { ...parsed, color: null, categoryId: null }) > 0)
    : candidates;
  const withColor = parsed.color ? onTopic.filter(p => matchesColor(p, parsed.color)) : onTopic;
  const strict = withColor.filter(p => inRange(p, parsed));
  if (strict.length) return { relaxed: null, products: strict.sort(byRelevance(parsed)).slice(0, limit) };

  // The budget is the constraint shoppers mean most literally, so the colour
  // goes first: "no white ones under 1500, but here are other colours".
  if (parsed.color) {
    const anyColor = onTopic.filter(p => inRange(p, parsed));
    if (anyColor.length) return { relaxed: 'color', products: anyColor.sort(byRelevance(parsed)).slice(0, limit) };
  }
  // Nothing at all inside the budget: show the nearest ones above it.
  if (parsed.maxRupees != null) {
    const overBudget = withColor.filter(p => inRange(p, { ...parsed, maxRupees: null }));
    if (overBudget.length) return { relaxed: 'budget', products: overBudget.sort(byPrice(parsed)).slice(0, limit) };
    if (candidates.length) return { relaxed: 'all', products: [...candidates].sort(byPrice(parsed)).slice(0, limit) };
  }
  if (candidates.length) return { relaxed: 'all', products: [...candidates].sort(byRelevance(parsed)).slice(0, limit) };
  return { relaxed: 'none', products: [] };
}

/**
 * The one seam where a language model would go.
 *
 * Its whole job is sentence -> filters; it never produces product facts, so
 * the worst a bad model answer can do is search for the wrong thing, which
 * the shopper then sees spelled out in the summary. Swapping the body for an
 * API call (and keeping `parseShopQuery` as the fallback when the key is
 * missing, the call fails, or it times out) is the only change needed --
 * everything downstream reads the same shape. No key exists on this project
 * today, so the parser is the live path and the feature works without one.
 */
export async function interpretQuery(sentence, categories = []) {
  return parseShopQuery(sentence, categories);
}
