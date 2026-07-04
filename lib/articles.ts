// Prevent this module from being imported in Client Components.
// If a "use client" file ever imports articles.ts, Next.js will throw a build
// error instead of silently shipping 73 KB of article data (including any
// draft-status entries) to the browser bundle.
import "server-only";

// ── M-5: Synthetic `views` field — READ BEFORE USING FOR DISPLAY ─────────────
//
// Every article object below has a `views` field.  These are HARDCODED,
// NEVER-UPDATED numbers authored at write time.  They are used ONLY as a
// stable sort key so that getTrendingArticles() and getMostReadArticles()
// return a consistent, hand-curated ranking during the static-data phase.
//
// They are NOT real view counts.  Do NOT display them to users as page-view
// figures — that would be deceptive UX.  The `views` field is intentionally
// absent from every public-facing component (ArticleCard, ArticleMeta, etc.)
// for this reason.
//
// ── Migration path (when MongoDB is live) ────────────────────────────────────
// 1. Add a `GET /api/articles/[id]/views` endpoint that returns the live count
//    from a `article_views` collection keyed by article id.
// 2. Add a `POST /api/articles/[id]/views` increment endpoint.  This endpoint
//    MUST have:
//      a. Per-IP rate limiting (reuse checkRateLimit from lib/rateLimit.ts,
//         limit: 1 req / article / 24 h per IP — prevents count inflation).
//      b. CSRF origin validation (isValidCsrfOrigin from lib/csrf.ts) to
//         block cross-origin automated POSTs.
//      c. An idempotency key (e.g. a signed cookie per article per session)
//         so that normal page reloads don't double-count.
// 3. Replace `views` in the article documents with the live DB count.
// 4. Update getTrendingArticles() and getMostReadArticles() to query MongoDB
//    with a sort on the live view count rather than the static field.
// 5. Remove the hardcoded `views` values from this file or mark them as
//    `_seedViews` (seed data only, never displayed) to avoid confusion.
// ─────────────────────────────────────────────────────────────────────────────

import { Article, PublicArticle } from "@/types";
import { authors } from "./authors";
import { categories } from "./categories";
import { sanitizeArticleContent } from "./sanitize";

const [world, politics, business, technology, sports, entertainment, health, science, opinion] = categories;
const [eleanor, marcus, priya, james, sofia, david, amara, tomas] = authors;

// _rawArticles is the unsanitized source array.  Do NOT export or use this
// directly — use the `_articles` internal array below which has `sanitizedContent`
// stamped on every entry by the M-9 write-time sanitization pass.
const _rawArticles = [
  // ─── WORLD ───────────────────────────────────────────────────────────────────
  {
    id: "art-001",
    title: "G20 Leaders Reach Historic Climate Accord in Emergency Summit",
    slug: "g20-leaders-historic-climate-accord-emergency-summit",
    excerpt: "In an unprecedented emergency convening, world leaders agreed to a binding framework that commits major economies to net-zero emissions by 2045, a full decade ahead of previous targets.",
    content: `<p>ROME — In a moment that analysts are already calling a turning point in global climate policy, leaders from the world's twenty largest economies emerged from a 48-hour emergency summit Saturday to announce a sweeping new accord that sets binding emissions targets and commits hundreds of billions of dollars to green energy transition in developing nations.</p>

<p>The agreement, formally titled the Rome Framework on Climate Action, was signed by all twenty heads of government just before midnight local time, following days of intense negotiations that at several points appeared to be on the verge of collapse. Negotiators from the European Union and a coalition of small island nations pushed hardest for the most ambitious targets, while major fossil fuel producers held out for longer timelines and greater financial assistance.</p>

<h2>The Core Commitments</h2>
<p>Under the Rome Framework, G20 nations will collectively reduce greenhouse gas emissions by 65 percent from 2005 levels by 2035, and achieve net-zero emissions no later than 2045. A new $400 billion Green Transition Fund will be established, financed by a tax on international financial transactions, to help lower-income countries build renewable energy infrastructure and adapt to climate impacts already underway.</p>

<p>"This is the most significant international climate agreement since Paris, and arguably more significant," said Dr. Elena Kovacs, director of the Climate Policy Initiative in Brussels. "Paris had voluntary targets. This has binding commitments, real financing, and for the first time a credible enforcement mechanism."</p>

<p>The enforcement mechanism — a first in climate diplomacy — allows member nations to impose tariffs on imports from countries that fall short of their commitments, subject to independent verification by a new UN Climate Compliance Commission.</p>

<h2>A Grueling Negotiation</h2>
<p>The path to the agreement was anything but smooth. Negotiations nearly broke down on Thursday when a group of oil-producing nations threatened to walk out over the pace of the phase-out of fossil fuel subsidies. A late compromise — which allows for a longer transition period in countries economically dependent on fossil fuel revenues — kept them at the table.</p>

<p>Environmental groups have criticized that compromise. "Giving the petrostates a decade longer weakens the whole framework," said Helena Greenwald of the Global Climate Coalition. "Every year of delayed action means more emissions we cannot afford."</p>

<p>Supporters of the deal counter that getting every major economy inside the tent is worth the concession. "A weak agreement that everyone signs is more valuable than a perfect agreement nobody does," said one senior European diplomat, speaking on condition of anonymity.</p>

<h2>What Comes Next</h2>
<p>The accord must now be ratified by the legislatures of each signatory nation, a process that faces uncertain prospects in several countries, including the United States, where Republican opposition has already vowed to challenge the agreement's constitutionality.</p>

<p>The first compliance review is scheduled for 2027, when an independent panel will assess whether nations are on track to meet their interim targets. Countries found to be significantly off-track will face a formal warning period before tariff measures can be applied.</p>

<p>Climate scientists, while cautiously welcoming the deal, warn that implementation is everything. "The targets are scientifically consistent with limiting warming to 1.5 degrees," said Dr. Rajiv Anand of the Intergovernmental Panel on Climate Change. "Whether they will be met depends entirely on domestic political will."</p>`,
    category: world,
    tags: ["climate", "G20", "environment", "international", "diplomacy"],
    author: eleanor,
    publishedAt: "2026-04-19T08:00:00Z",
    readingTime: 6,
    featuredImage: "/article-images/art-001-world.svg",
    featuredImageAlt: "World leaders at G20 summit",
    featuredImageCaption: "G20 leaders pose for a photograph before the final session of the emergency climate summit in Rome. (Faulter / AFP)",
    isFeatured: true,
    isTrending: true,
    isMostRead: true,
    isBreaking: false,
    status: "published",
    views: 84200,
    relatedArticleIds: ["art-002", "art-008", "art-015"],
  },
  {
    id: "art-002",
    title: "Ukraine Ceasefire Talks Stall as Both Sides Claim Violations",
    slug: "ukraine-ceasefire-talks-stall-violations",
    excerpt: "Diplomatic efforts to broker a lasting ceasefire in Ukraine have hit a fresh impasse, with negotiators from both sides trading accusations of bad faith and continued shelling reported along the eastern front.",
    content: `<p>GENEVA — Fragile ceasefire negotiations between Ukraine and Russia ground to a halt Friday after both delegations accused the other of continuing military operations in violation of an interim agreement reached last month, raising fears that the latest diplomatic effort is on the verge of collapse.</p>

<p>The talks, brokered by a coalition of European nations and hosted in Geneva under the auspices of the United Nations, had been widely seen as the most promising opportunity for a lasting cessation of hostilities since the conflict began. But three rounds of negotiations over two weeks failed to produce agreement on a single substantive issue, and the mood among diplomats in the city has darkened considerably.</p>

<h2>Accusations Fly</h2>
<p>Ukraine's lead negotiator, Foreign Minister Olena Bondarenko, told reporters outside the UN Palais des Nations on Friday that Russian forces had conducted 47 artillery strikes in the preceding 24 hours in violation of the interim ceasefire. "We came here in good faith. We see no reciprocal good faith," she said. "How do you negotiate peace while shells are still falling?"</p>

<p>Russia's delegation, led by Deputy Foreign Minister Andrei Volkov, rejected those characterizations as "fabrications designed to torpedo the talks." He alleged that Ukrainian forces had launched several drone strikes against Russian-held territory and accused Western nations of supplying advanced weapons systems that were being used in active combat.</p>

<p>The UN mediator, former Norwegian Prime Minister Astrid Holm, described the exchanges as "deeply concerning" and called on both sides to return to the table, warning that a breakdown in negotiations would have "catastrophic consequences for the civilians still caught in the conflict zone."</p>

<h2>The Humanitarian Toll</h2>
<p>More than 4.8 million people remain displaced within Ukraine, according to UN figures, and humanitarian organizations warn that the approaching winter could be deadly without significant improvements in infrastructure and supply routes. The Geneva talks had been expected to include provisions for humanitarian corridors, but those discussions have not even begun.</p>

<p>A further round of talks has been tentatively scheduled for next week, though officials on both sides privately expressed doubt that a breakthrough was imminent.</p>`,
    category: world,
    tags: ["ukraine", "russia", "war", "diplomacy", "ceasefire"],
    author: eleanor,
    publishedAt: "2026-04-18T14:30:00Z",
    readingTime: 5,
    featuredImage: "/article-images/art-002-world.svg",
    featuredImageAlt: "Diplomatic talks in Geneva",
    isFeatured: false,
    isTrending: true,
    isMostRead: false,
    isBreaking: true,
    status: "published",
    views: 62100,
    relatedArticleIds: ["art-001", "art-010"],
  },
  {
    id: "art-003",
    title: "India's General Election: Modi Faces Strongest Challenge in a Decade",
    slug: "india-general-election-modi-strongest-challenge",
    excerpt: "With voting underway across India's vast electoral districts, Prime Minister Narendra Modi's ruling coalition faces a more united opposition than at any point in recent years, with economic anxiety and regional grievances shaping the contest.",
    content: `<p>NEW DELHI — Hundreds of millions of Indians have begun casting ballots in what is shaping up to be the most competitive general election in a decade, with Prime Minister Narendra Modi's ruling Bharatiya Janata Party facing a reinvigorated opposition that has consolidated around a single coalition for the first time since 2014.</p>

<p>The 39-phase election, which will conclude in late May before results are announced, will determine control of the Lok Sabha, the lower house of India's parliament, and whether Modi will secure a third consecutive term as the world's most populous democracy charts its political course.</p>

<h2>Economic Fault Lines</h2>
<p>While the BJP has campaigned heavily on India's strong GDP growth numbers — the economy expanded 7.2 percent last year — the opposition has focused relentlessly on what they call a "jobs crisis" and the widening gap between India's wealthy urban elite and its vast rural poor. Unemployment among young graduates has become a particularly sensitive issue, with polling showing it as the top concern among voters under 35.</p>

<p>"The headlines say India is booming," said Prashant Nair, an opposition strategist. "The people in the villages say they cannot feed their children. The BJP has to answer for that gap."</p>

<p>BJP officials reject that characterization, pointing to record infrastructure spending and a series of welfare programmes that they say have lifted more than 250 million people out of poverty over the past decade.</p>

<h2>The Opposition Coalition</h2>
<p>The INDIA alliance, a broad coalition of regional parties and the historic Congress party, has managed to stay united longer than many observers expected, presenting a joint candidate in most constituencies and thus avoiding the vote-splitting that has historically benefited the BJP in a first-past-the-post system.</p>

<p>Early voting data suggests turnout is running slightly ahead of 2019 levels in several key swing states, including Uttar Pradesh, Maharashtra, and West Bengal. Analysts will be watching those states closely as the results come in.</p>`,
    category: world,
    tags: ["india", "election", "modi", "politics", "democracy"],
    author: james,
    publishedAt: "2026-04-17T09:15:00Z",
    readingTime: 7,
    featuredImage: "/article-images/art-003-politics.svg",
    featuredImageAlt: "Voting in India's general election",
    isFeatured: false,
    isTrending: false,
    isMostRead: true,
    isBreaking: false,
    status: "published",
    views: 48900,
    relatedArticleIds: ["art-009", "art-018"],
  },

  // ─── POLITICS ──────────────────────────────────────────────────────────────
  {
    id: "art-004",
    title: "Senate Passes Landmark Infrastructure Bill After Years of Stalled Negotiations",
    slug: "senate-passes-landmark-infrastructure-bill",
    excerpt: "The Senate voted 58-42 Thursday to pass the National Infrastructure Renewal Act, a $1.2 trillion package that promises to rebuild the country's aging roads, bridges, broadband, and water systems over the next decade.",
    content: `<p>WASHINGTON — The United States Senate passed a sweeping $1.2 trillion infrastructure bill Thursday, ending years of bipartisan negotiations with a vote that saw eight Republicans break with their party to provide the margin of victory in one of the largest domestic spending packages in a generation.</p>

<p>The National Infrastructure Renewal Act, which now moves to the House of Representatives, would channel federal funds into rebuilding the country's roads, bridges, rail networks, broadband internet, and drinking water systems over ten years. Proponents call it the most significant investment in American infrastructure since the Interstate Highway System was constructed in the 1950s.</p>

<h2>What's in the Bill</h2>
<p>The legislation includes $350 billion for highway and bridge repair, $110 billion for passenger and freight rail, $65 billion to extend high-speed broadband to rural and underserved communities, $55 billion for clean water infrastructure, and $73 billion to modernize the nation's electrical grid. An additional $39 billion is earmarked for public transit systems in major metropolitan areas.</p>

<p>The bill is projected to create 1.5 million new jobs annually over the decade, according to a nonpartisan analysis by the Congressional Budget Office, with particular benefits for workers in construction, manufacturing, and engineering.</p>

<h2>Political Calculus</h2>
<p>The eight Republican senators who voted in favour cited the bill's targeted spending on physical infrastructure, distinguishing it from broader social spending proposals that the party opposes. "This is about roads and bridges, water pipes and internet cables," said Senator William Marchetti of Ohio. "That is the proper role of federal investment."</p>

<p>Progressive Democrats had pushed for a larger package with greater emphasis on clean energy and social programmes, and some expressed frustration that those priorities were not included. "This is a compromise, not a victory," said Senator Aisha Washington of California. "We needed more, and we will keep fighting for more."</p>

<p>The bill now faces a contested path in the House, where the narrow Democratic majority must hold together against both Republican opposition and dissatisfaction from the progressive wing of the party.</p>`,
    category: politics,
    tags: ["senate", "infrastructure", "legislation", "bipartisan", "US politics"],
    author: david,
    publishedAt: "2026-04-18T18:00:00Z",
    readingTime: 6,
    featuredImage: "/article-images/art-004-politics.svg",
    featuredImageAlt: "US Capitol building",
    isFeatured: false,
    isTrending: true,
    isMostRead: true,
    isBreaking: false,
    status: "published",
    views: 71500,
    relatedArticleIds: ["art-009", "art-019"],
  },
  {
    id: "art-005",
    title: "European Parliament Elections: Far-Right Surge Reshapes Political Landscape",
    slug: "european-parliament-elections-far-right-surge",
    excerpt: "Preliminary results from across EU member states show nationalist and far-right parties making substantial gains in the European Parliament, threatening to alter the balance of power in Brussels on issues from migration to climate policy.",
    content: `<p>BRUSSELS — Nationalist and right-wing populist parties across the European Union scored major gains in European Parliament elections this week, with preliminary tallies showing the centre-right European People's Party and its potential right-wing partners positioned to hold a combined majority for the first time since the Parliament was established.</p>

<p>The results, while not yet final, signal a significant rightward shift in European politics at a moment when the EU faces overlapping crises: the ongoing conflict in Ukraine, slowing economic growth, persistent inflation, and a migration debate that has energized nationalist movements from Sweden to Italy.</p>

<h2>Winners and Losers</h2>
<p>The most dramatic gains came in France, where Marine Le Pen's National Rally party topped the polls with 32 percent of the vote, more than double the share received by President Emmanuel Macron's centrist alliance. In Germany, the far-right Alternative für Deutschland came in second, despite ongoing legal challenges over its leadership, with 17 percent. The Swedish Democrats and Italy's Brothers of Italy both improved on their previous performances.</p>

<p>On the left, the Greens suffered particularly heavy losses, losing more than a quarter of their seats across the bloc as voters in several countries signalled dissatisfaction with the pace and economic cost of the green transition. Socialist and social democratic parties broadly held their ground but failed to offset the overall rightward trend.</p>

<h2>Implications for EU Policy</h2>
<p>The composition of the new Parliament raises serious questions about the future of several flagship EU initiatives. The European Green Deal, the bloc's signature climate policy framework, could face serious modifications if the far-right and right-wing nationalist parties use their combined leverage to demand changes as a condition of supporting the new European Commission president.</p>

<p>Migration policy is likely to shift significantly. Several nationalist parties have explicitly campaigned on tighter borders, expedited deportations, and externalisation of asylum processing. With more seats, they have more leverage to demand those policies from whichever coalition forms to govern.</p>`,
    category: politics,
    tags: ["EU", "elections", "far-right", "Europe", "parliament"],
    author: eleanor,
    publishedAt: "2026-04-16T22:00:00Z",
    readingTime: 8,
    featuredImage: "/article-images/art-005-politics.svg",
    featuredImageAlt: "European Parliament building in Brussels",
    isFeatured: true,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 39800,
    relatedArticleIds: ["art-001", "art-003"],
  },

  // ─── BUSINESS ──────────────────────────────────────────────────────────────
  {
    id: "art-006",
    title: "Federal Reserve Signals Rate Cuts May Come Sooner Than Expected",
    slug: "federal-reserve-signals-rate-cuts-sooner-than-expected",
    excerpt: "Fed Chair Jerome Powell indicated in remarks to the Economic Club of New York that cooling inflation data may allow the central bank to begin reducing its benchmark interest rate earlier than the market had anticipated.",
    content: `<p>NEW YORK — Federal Reserve Chair Jerome Powell signalled Thursday that the central bank may be prepared to begin cutting interest rates sooner than financial markets had anticipated, citing a sustained improvement in inflation data and some softening in the labour market that suggests the aggressive rate-hiking cycle of recent years has achieved its intended effect.</p>

<p>Speaking before the Economic Club of New York, Powell said that while the Fed was not yet confident that inflation had been sustainably brought to its 2 percent target, the trend of recent months had been "encouraging" and warranted "careful consideration" of the path ahead.</p>

<h2>Market Reaction</h2>
<p>Financial markets responded sharply to Powell's remarks. The S&P 500 rose 1.8 percent on the day, while the tech-heavy Nasdaq gained 2.3 percent. Treasury yields fell across the curve, with the benchmark 10-year yield dropping to 3.87 percent from 4.01 percent the previous day.</p>

<p>Futures markets moved to price in a 70 percent probability of a rate cut at the Fed's June meeting, up from 35 percent before Powell's speech. Economists at several major banks revised their forecasts, with Goldman Sachs and JPMorgan both moving their anticipated first-cut dates from September to June.</p>

<h2>The Economic Context</h2>
<p>The shift in tone comes against a backdrop of mixed economic signals. Consumer price inflation came in at 2.4 percent year-over-year in the most recent reading, its lowest level since early 2021 and down from a peak of 9.1 percent in 2022. Core inflation, which excludes volatile food and energy prices, has been slower to fall, remaining at 3.1 percent — still above target but on a clear downward trend.</p>

<p>The labour market, while still historically strong, has shown signs of cooling. Job creation in the past three months has averaged 165,000 per month, down from the 250,000-plus pace of 2024. The unemployment rate has edged up to 4.1 percent from a cycle low of 3.4 percent.</p>

<p>Not all economists are convinced that rate cuts are warranted imminently. "The last mile on inflation is always the hardest," said Dr. Catherine Novak, a former Fed economist now at the Peterson Institute. "Cutting too soon risks undoing a lot of hard work."</p>`,
    category: business,
    tags: ["federal reserve", "interest rates", "inflation", "economy", "markets"],
    author: priya,
    publishedAt: "2026-04-19T16:45:00Z",
    readingTime: 5,
    featuredImage: "/article-images/art-006-business.svg",
    featuredImageAlt: "Federal Reserve building in Washington DC",
    isFeatured: false,
    isTrending: true,
    isMostRead: true,
    isBreaking: false,
    status: "published",
    views: 58700,
    relatedArticleIds: ["art-007", "art-014"],
  },
  {
    id: "art-007",
    title: "Tech Giants Face Record $12 Billion Antitrust Fine from European Commission",
    slug: "tech-giants-record-antitrust-fine-european-commission",
    excerpt: "The European Commission levied its largest-ever antitrust fine against a consortium of major technology companies, citing systematic anti-competitive practices in digital advertising markets over the past five years.",
    content: `<p>BRUSSELS — The European Commission on Friday imposed a record €11.2 billion ($12.1 billion) fine on a group of major technology companies, concluding a five-year investigation into coordinated anti-competitive behaviour in digital advertising markets that regulators say harmed both publishers and consumers.</p>

<p>The fine, the largest in the Commission's history and more than double the previous record, targets three companies whose names are subject to a legal confidentiality order pending appeal, though sources familiar with the investigation confirmed the companies involved include some of the most prominent names in the global technology industry.</p>

<h2>What Regulators Found</h2>
<p>The Commission's investigation found evidence that the companies had engaged in systematic coordination to suppress competition in the market for programmatic advertising — the automated, real-time system by which most digital advertisements are bought and sold. Specifically, regulators found that the companies shared confidential bidding information, allowing them to suppress auction prices and lock out competing platforms.</p>

<p>EU Competition Commissioner Helena Bergström said the practices had "hollowed out competition in one of the most important and lucrative sectors of the digital economy." She said publishers — including news organisations, entertainment platforms, and content creators — had lost an estimated €40 billion in revenue over the period covered by the investigation as a result of the suppressed auction prices.</p>

<h2>Industry Response</h2>
<p>The affected companies did not publicly comment, as is standard practice pending appeal, but sources close to the investigation said they intend to challenge the fine in the EU's General Court, a process that could take several years. Previous large EU tech fines have been partially reduced on appeal, though never overturned entirely.</p>

<p>Industry groups warned that the fine would deter investment and innovation in Europe. "Fines of this magnitude, based on contested legal theories, create enormous uncertainty for any company doing business in Europe," said James Whitmore of the Computer and Communications Industry Association.</p>`,
    category: business,
    tags: ["antitrust", "EU", "tech", "fine", "digital advertising"],
    author: priya,
    publishedAt: "2026-04-17T12:00:00Z",
    readingTime: 6,
    featuredImage: "/article-images/art-007-technology.svg",
    featuredImageAlt: "Tech company offices",
    isFeatured: false,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 31200,
    relatedArticleIds: ["art-008", "art-006"],
  },

  // ─── TECHNOLOGY ────────────────────────────────────────────────────────────
  {
    id: "art-008",
    title: "OpenAI Unveils GPT-6: A Model That Reasons Across Scientific Disciplines",
    slug: "openai-gpt6-model-reasons-scientific-disciplines",
    excerpt: "OpenAI's latest model demonstrates an unprecedented ability to synthesize knowledge across medicine, mathematics, and physics, raising both excitement about scientific applications and fresh concerns about misuse.",
    content: `<p>SAN FRANCISCO — OpenAI on Thursday unveiled GPT-6, the latest iteration of its flagship artificial intelligence model, showcasing capabilities that the company says represent a qualitative leap in the ability of AI systems to perform complex, multi-step reasoning across disparate scientific domains.</p>

<p>In a live demonstration before journalists and invited researchers, GPT-6 was asked to analyse a novel protein interaction that had stumped researchers at a collaborating laboratory for months. The model proposed a hypothesis — ultimately confirmed by the lab's scientists as consistent with their experimental data — within 90 seconds of being given access to the relevant literature and raw data.</p>

<h2>What's New in GPT-6</h2>
<p>The model's most significant advance, according to OpenAI's published technical report, is what the company calls "domain-bridging synthesis" — the ability to recognize when a problem in one field of knowledge can be illuminated by insights from another. In benchmarks, the model showed particular strength in identifying analogues between biological systems and computational architecture, and between economic models and physical simulations.</p>

<p>GPT-6 also shows substantially improved performance on formal mathematical reasoning, solving 78 percent of problems from the International Mathematical Olympiad dataset, compared to 61 percent for its predecessor. In medical diagnosis benchmarks, the model matched or exceeded specialist-level performance on 14 of 20 clinical specialties tested.</p>

<h2>Concerns and Controversy</h2>
<p>The announcement has reignited debate about the pace of AI development and the adequacy of existing safety measures. Several prominent AI researchers published an open letter within hours of the announcement, calling on OpenAI to delay the model's public release pending independent safety evaluation.</p>

<p>"The capabilities described in this release are qualitatively different from what has come before," said Dr. Anna Fischer of the Center for AI Safety. "We need to understand the failure modes before this is in millions of people's hands."</p>

<p>OpenAI CEO Sam Altman defended the company's safety process, saying GPT-6 had undergone more than 18 months of internal red-teaming and independent evaluation before release. The model will be made available through the ChatGPT interface and API starting next month, with some capabilities initially restricted to research partners.</p>`,
    category: technology,
    tags: ["AI", "OpenAI", "GPT-6", "machine learning", "technology"],
    author: marcus,
    publishedAt: "2026-04-18T10:00:00Z",
    readingTime: 7,
    featuredImage: "/article-images/art-008-technology.svg",
    featuredImageAlt: "Artificial intelligence visualization",
    isFeatured: true,
    isTrending: true,
    isMostRead: true,
    isBreaking: false,
    status: "published",
    views: 112400,
    relatedArticleIds: ["art-007", "art-015", "art-020"],
  },
  {
    id: "art-009",
    title: "Apple's Vision Pro 2 Launches to Record Pre-Orders Despite Premium Price",
    slug: "apple-vision-pro-2-launches-record-preorders",
    excerpt: "Apple's second-generation spatial computing headset garnered 2.4 million pre-orders in its first 24 hours despite a starting price of $3,499, suggesting that what many called a niche product has found a broader audience.",
    content: `<p>CUPERTINO, Calif. — Apple logged 2.4 million pre-orders for the Vision Pro 2 within 24 hours of opening reservations last week, the company confirmed, a figure that would put the spatial computing headset on a trajectory to exceed the first year of the original Vision Pro by a factor of more than four.</p>

<p>The strong pre-order demand has surprised analysts who had expected consumers to balk at the device's $3,499 starting price. Instead, the numbers suggest that a combination of substantially improved capabilities, a lighter form factor, and — critically — the growth of a software ecosystem around the original Vision Pro has broadened the appeal of the product beyond its early-adopter base.</p>

<h2>What's New</h2>
<p>The Vision Pro 2 features Apple's M4 Ultra processor, providing roughly 2.8 times the computational performance of the original with 40 percent less power consumption. The headset weighs 15 percent less than its predecessor, addressing one of the most consistent criticisms of the first model. The display resolution has been increased to 4K per eye, and a new eye-tracking system reduces the latency of gaze-based interaction to under 5 milliseconds.</p>

<p>Perhaps most significantly for developers, Apple has introduced a new "persistent objects" API that allows spatial computing applications to place virtual objects in the real world that remain exactly where the user left them between sessions. Industry observers believe this will unlock a new generation of productivity applications that are not possible on flat-screen devices.</p>

<h2>The Competitive Landscape</h2>
<p>Meta's Quest 4 and Sony's PlayStation VR3 both compete in the extended reality market, though at considerably lower price points. Apple's strategy has been to position the Vision Pro as a productivity and professional tool rather than a gaming or entertainment device, targeting a different — and potentially more revenue-rich — customer segment.</p>`,
    category: technology,
    tags: ["Apple", "Vision Pro", "spatial computing", "augmented reality", "hardware"],
    author: marcus,
    publishedAt: "2026-04-16T08:30:00Z",
    readingTime: 5,
    featuredImage: "/article-images/art-009-technology.svg",
    featuredImageAlt: "Augmented reality headset technology",
    isFeatured: false,
    isTrending: false,
    isMostRead: true,
    isBreaking: false,
    status: "published",
    views: 93100,
    relatedArticleIds: ["art-008", "art-020"],
  },

  // ─── SPORTS ────────────────────────────────────────────────────────────────
  {
    id: "art-010",
    title: "Champions League Final: Real Madrid Clinches Record 16th Title in Dramatic Shootout",
    slug: "champions-league-final-real-madrid-16th-title-shootout",
    excerpt: "A pulsating final at Wembley ended 2-2 after extra time before Real Madrid edged Paris Saint-Germain in a penalty shootout to claim an unprecedented 16th UEFA Champions League crown.",
    content: `<p>LONDON — Kylian Mbappé, ironically, missed the decisive penalty as his PSG side fell to his former club in the most dramatic of endings. Real Madrid goalkeeper Thibaut Courtois, man of the match despite his side trailing twice during regulation, dived to his right to palm away the Frenchman's spot-kick and send Madrid's players into a frenzy of celebration.</p>

<p>The 2-2 draw after 120 minutes had done justice to an absorbing match that swung back and forth across the vast green expanse of a sold-out Wembley Stadium. PSG's Ousmane Dembélé put the French champions ahead with a stunning long-range effort in the 23rd minute, only for Vinícius Júnior to equalize just before half-time with a solo run that left four defenders in his wake.</p>

<h2>The Drama Unfolds</h2>
<p>PSG restored their lead through a clinical Marco Asensio header from a corner in the 67th minute, but Madrid — as has so often been the case in their storied European history — refused to accept defeat. Jude Bellingham, magnificent throughout in the deep midfield role, drove forward and was brought down in the penalty area in the 88th minute. Vinícius converted the spot-kick with a composure that belied the occasion to force extra time.</p>

<p>The shootout that followed was a masterclass in nerve. Madrid converted their first four penalties flawlessly before Courtois's save from Mbappé handed them the trophy.</p>

<h2>A Dynasty Reaffirmed</h2>
<p>"This club is different," said manager Carlo Ancelotti, who with this victory became the only coach to win the Champions League five times. "When the moment comes, this club finds a way." It was a sentiment that his players, embracing on the Wembley turf as fireworks lit the London night, clearly shared.</p>`,
    category: sports,
    tags: ["Champions League", "Real Madrid", "football", "UEFA", "PSG"],
    author: tomas,
    publishedAt: "2026-04-19T23:30:00Z",
    readingTime: 5,
    featuredImage: "/article-images/art-010-sports.svg",
    featuredImageAlt: "Champions League trophy",
    isFeatured: false,
    isTrending: true,
    isMostRead: true,
    isBreaking: true,
    status: "published",
    views: 205000,
    relatedArticleIds: ["art-011", "art-012"],
  },
  {
    id: "art-011",
    title: "IOC Announces Los Angeles 2028 Olympic Programme Including Breakdancing, Cricket",
    slug: "ioc-la-2028-olympic-programme-breakdancing-cricket",
    excerpt: "The International Olympic Committee finalised the sport programme for the 2028 Los Angeles Games, confirming the return of breakdancing alongside the debut appearances of T20 cricket, flag football, and lacrosse.",
    content: `<p>LAUSANNE — The International Olympic Committee on Thursday confirmed the full sports programme for the Los Angeles 2028 Olympic Games, formally approving the inclusion of T20 cricket and flag football as new events and confirming the return of breakdancing after its Paris debut, along with the long-awaited return of lacrosse and squash to the Olympic stage.</p>

<p>The addition of cricket is the most historically significant change, bringing the world's second-most popular sport back to the Olympics for the first time since 1900, when it featured in just a single match at the Paris Games between England and a combined French team. The T20 format, cricket's shortest and most television-friendly version, is expected to draw massive audiences in South Asia and other cricket-mad regions.</p>

<h2>Flag Football's Moment</h2>
<p>Flag football — the non-contact version of American football — is similarly seen as a calculated attempt to energize American audiences for a home Games. The NFL has been deeply involved in promoting the sport internationally, and events have already been staged in several countries as part of an expansion push that predates the Olympic inclusion.</p>

<p>The full 2028 programme will include 32 sports, up from 32 in Paris, with a total of 329 events across the Games. The organisers have committed to holding competitions in 11 different venues across greater Los Angeles, as well as events in New York, Miami, and Dallas to maximise reach and commercial revenue.</p>`,
    category: sports,
    tags: ["Olympics", "LA 2028", "IOC", "cricket", "flag football"],
    author: tomas,
    publishedAt: "2026-04-17T14:00:00Z",
    readingTime: 5,
    featuredImage: "/article-images/art-011-sports.svg",
    featuredImageAlt: "Olympic rings",
    isFeatured: false,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 24500,
    relatedArticleIds: ["art-010", "art-012"],
  },

  // ─── HEALTH ────────────────────────────────────────────────────────────────
  {
    id: "art-012",
    title: "WHO Declares Mpox Variant Public Health Emergency of International Concern",
    slug: "who-mpox-variant-public-health-emergency-international-concern",
    excerpt: "The World Health Organization invoked its highest-level alert status for a new mpox variant detected in Central Africa that has shown faster transmission and more severe clinical presentation than previously observed strains.",
    content: `<p>GENEVA — The World Health Organization declared a Public Health Emergency of International Concern on Friday for a new mpox variant, known as clade Ib, that has spread to 14 countries across Central and East Africa and has now been detected in isolated cases in Europe and South Asia, the organisation's director-general announced at an emergency press conference.</p>

<p>The declaration, which triggers international protocols for information sharing, border health measures, and resource mobilisation, comes after the variant recorded nearly 8,000 confirmed cases and 312 deaths in the preceding three months — a case fatality rate of roughly 4 percent, substantially higher than the 0.1 percent seen in the 2022 global mpox outbreak.</p>

<h2>What Makes This Variant Different</h2>
<p>Scientists studying clade Ib say its transmission dynamics differ from previous mpox strains in important ways. While the 2022 outbreak spread primarily through close sexual contact among specific communities, clade Ib appears to transmit more readily through routine household contact, including among children. This broadens the at-risk population significantly.</p>

<p>"The epidemiology of this variant is different, and that means our response must be different," said Dr. Sylvie Briand, head of the WHO's global infectious hazard preparedness division. "The same interventions that worked in 2022 are not sufficient here."</p>

<h2>Vaccine Supply and Response</h2>
<p>The WHO has already begun coordinating the distribution of existing mpox vaccines, which have been shown to be effective against all known strains, to affected countries. However, global vaccine supply remains limited, and health officials acknowledged that targeted deployment in the highest-burden areas would be necessary in the near term while production is scaled up.</p>`,
    category: health,
    tags: ["mpox", "WHO", "pandemic", "public health", "virus"],
    author: sofia,
    publishedAt: "2026-04-19T11:00:00Z",
    readingTime: 6,
    featuredImage: "/article-images/art-012-health.svg",
    featuredImageAlt: "Medical health emergency",
    isFeatured: false,
    isTrending: true,
    isMostRead: false,
    isBreaking: true,
    status: "published",
    views: 67800,
    relatedArticleIds: ["art-013", "art-015"],
  },
  {
    id: "art-013",
    title: "Landmark Trial Shows Weekly Pill Reduces Alzheimer's Progression by 40 Percent",
    slug: "landmark-trial-weekly-pill-reduces-alzheimers-progression-40-percent",
    excerpt: "A Phase 3 clinical trial involving 4,500 patients across 12 countries has found that a once-weekly oral medication significantly slows the cognitive decline associated with early-stage Alzheimer's disease.",
    content: `<p>BOSTON — A large international clinical trial has found that a once-weekly oral medication produced by Swiss pharmaceutical company Roche Holding significantly slowed the progression of Alzheimer's disease in patients with early-stage symptoms, offering what scientists say could be the most practical treatment advance yet for a condition affecting more than 55 million people worldwide.</p>

<p>The trial, called SUNRISE-3, enrolled 4,527 patients across 47 sites in 12 countries, all diagnosed with mild cognitive impairment or early Alzheimer's dementia confirmed by biomarker testing. Half received the drug, called remternetug, once weekly; the other half received a placebo. After 18 months, patients on the drug showed 40 percent slower progression on standard cognitive assessments compared to the placebo group.</p>

<h2>Why This Trial Matters</h2>
<p>Previous Alzheimer's treatments have required intravenous infusions at specialised clinics every two to four weeks, a significant practical barrier for patients and caregivers. Remternetug, if approved, would be the first disease-modifying Alzheimer's treatment available as a standard pill, dramatically increasing accessibility.</p>

<p>"The efficacy is not the biggest story here, though it is significant," said Dr. Michael Torres of Massachusetts General Hospital, one of the trial's principal investigators. "The story is that we may have found a way to treat this disease that people can actually access — at home, with a glass of water."</p>

<h2>Regulatory Path</h2>
<p>Roche said it plans to file for regulatory approval with the FDA and European Medicines Agency within the next six months. If granted — and the trial results would support a strong application — the drug could be available to patients within 18 months. The company has not yet disclosed pricing, a sensitive issue given the cost of existing Alzheimer's treatments.</p>`,
    category: health,
    tags: ["Alzheimer's", "clinical trial", "dementia", "medicine", "pharma"],
    author: sofia,
    publishedAt: "2026-04-18T09:00:00Z",
    readingTime: 7,
    featuredImage: "/article-images/art-013-health.svg",
    featuredImageAlt: "Medical research laboratory",
    isFeatured: false,
    isTrending: false,
    isMostRead: true,
    isBreaking: false,
    status: "published",
    views: 89200,
    relatedArticleIds: ["art-012", "art-015"],
  },

  // ─── SCIENCE ───────────────────────────────────────────────────────────────
  {
    id: "art-014",
    title: "NASA's Europa Clipper Returns First Images of Potential Subsurface Ocean Vents",
    slug: "nasa-europa-clipper-first-images-subsurface-ocean-vents",
    excerpt: "Scientists analysing data from NASA's Europa Clipper spacecraft have announced the discovery of surface features they believe are direct evidence of active hydrothermal vents beneath the ice shell of Jupiter's moon Europa.",
    content: `<p>PASADENA, Calif. — Scientists working with data from NASA's Europa Clipper spacecraft announced Friday the discovery of what they believe to be the surface signatures of active hydrothermal vents beneath the ice shell of Jupiter's moon Europa — a finding that would dramatically increase the prospects of finding life beyond Earth.</p>

<p>The Clipper, which entered Europa's orbital vicinity in late 2025 after a six-year journey, has been conducting close flybys of the moon's surface using a suite of instruments including a high-resolution camera, a radar system capable of penetrating the ice, and a mass spectrometer that can analyse the composition of material ejected into space.</p>

<h2>The Evidence</h2>
<p>The surface features in question are a series of ridged formations near Europa's equatorial region that the team says are morphologically consistent with the upwelling and refreezing of warmer water from below — a process analogous to the mid-ocean ridge systems on Earth that are home to some of the planet's most extreme ecosystems. Thermal imaging from the spacecraft shows those formations to be slightly warmer than the surrounding terrain, consistent with active geological processes beneath.</p>

<p>"We have suspected for decades that Europa has a subsurface ocean," said Dr. Carolyn Porco of the Space Science Institute, who was not involved in the research. "What this data suggests — and I want to be careful, this is not yet confirmed — is that this ocean is in contact with a rocky seafloor, and that contact may be creating conditions for chemistry very similar to what produced life on Earth."</p>

<h2>What Comes Next</h2>
<p>The Clipper team plans five additional close flybys of the region over the next year to gather more data. NASA is also developing plans for a follow-on mission — a lander that would touch down near one of the vent sites — though funding for that mission has not yet been approved by Congress.</p>`,
    category: science,
    tags: ["NASA", "Europa", "space", "astrobiology", "life beyond Earth"],
    author: sofia,
    publishedAt: "2026-04-19T13:30:00Z",
    readingTime: 7,
    featuredImage: "/article-images/art-014-science.svg",
    featuredImageAlt: "Jupiter's moon Europa",
    isFeatured: false,
    isTrending: true,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 54300,
    relatedArticleIds: ["art-015", "art-008"],
  },
  {
    id: "art-015",
    title: "Quantum Computer Solves Protein Folding Problem in Seconds, Not Years",
    slug: "quantum-computer-protein-folding-problem-seconds",
    excerpt: "Researchers at the University of Toronto, using a 2,000-qubit quantum processor, have demonstrated the ability to predict the three-dimensional structure of complex proteins in seconds — a computation that would take classical computers years.",
    content: `<p>TORONTO — Researchers at the University of Toronto and the Vector Institute for Artificial Intelligence have demonstrated that a 2,000-qubit quantum computer can predict the complete three-dimensional folding structure of large, complex proteins in under 30 seconds — a computation that would require more than three years on the world's most powerful conventional supercomputer, they reported in Nature on Wednesday.</p>

<p>The breakthrough represents a significant advance in both quantum computing and structural biology, with potential implications ranging from drug discovery to the design of novel materials and industrial enzymes.</p>

<h2>Why Protein Folding Matters</h2>
<p>Proteins are the molecular machines that carry out virtually every biological function. Their ability to perform those functions depends critically on the three-dimensional shape they fold into after being synthesized. Misfolded proteins are implicated in diseases including Alzheimer's, Parkinson's, and many cancers. Being able to rapidly predict protein structure allows scientists to design drugs that interact with those structures, and to engineer new proteins with desired properties.</p>

<p>The AlphaFold system developed by DeepMind transformed structural biology by using artificial intelligence to predict protein structures with unprecedented accuracy. The Toronto result goes further, the researchers claim, by solving an even more computationally complex problem: predicting not just the most stable structure, but the full landscape of structures a protein can adopt as it folds — information crucial for understanding protein function and misfolding dynamics.</p>

<h2>Caveats and Context</h2>
<p>Other quantum computing researchers urged caution in interpreting the results. "This is an impressive demonstration, but the proteins tested were in a class that is relatively amenable to quantum approaches," said Dr. Lin Wei of MIT's Research Laboratory of Electronics. "The hardest proteins in the hardest environments — those are still a different challenge."</p>`,
    category: science,
    tags: ["quantum computing", "protein folding", "biology", "breakthrough", "science"],
    author: marcus,
    publishedAt: "2026-04-17T16:00:00Z",
    readingTime: 6,
    featuredImage: "/article-images/art-015-science.svg",
    featuredImageAlt: "Quantum computing visualization",
    isFeatured: false,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 42700,
    relatedArticleIds: ["art-008", "art-014"],
  },

  // ─── ENTERTAINMENT ─────────────────────────────────────────────────────────
  {
    id: "art-016",
    title: "Cannes Film Festival Preview: The Films Everyone Will Be Talking About",
    slug: "cannes-film-festival-preview-films-everyone-talking-about",
    excerpt: "With the 79th Cannes Film Festival weeks away, we survey the most anticipated films in competition and offer our predictions for the Palme d'Or, the prizes that follow, and the controversies that always attend cinema's most glamorous gathering.",
    content: `<p>There is something perennially irresistible about Cannes. A film festival that has somehow managed to remain simultaneously the most commercially important and the most artistically prestigious event in world cinema, despite — or perhaps because of — the cognitive dissonance that produces. This year's edition promises to be one of the more interesting in recent memory.</p>

<p>The competition selection, announced last week by Festival Director Thierry Frémaux, is notable for the relative absence of established auteurs and the prominence of first and second features from directors who have never before competed for the Palme d'Or. It is a selection that appears to be making a statement: cinema's future matters more than its past.</p>

<h2>Films to Watch</h2>
<p>The most anticipated title is almost certainly <em>The Hours After</em>, the new film from Iranian-British director Shirin Moradi, whose debut feature won the Camera d'Or four years ago. The film stars Cate Blanchett as a diplomat in an unnamed Middle Eastern capital navigating the aftermath of a coup; early buzz from those who have seen a rough cut describes it as a quietly devastating study in moral compromise.</p>

<p>Also attracting significant interest is <em>Pacífico</em>, a Spanish-language drama from debut director Carlos Vega about three generations of a Colombian family and the silence that surrounds a wartime secret. Festival programmers who saw it in rough cut have described it in superlatives that would normally be cause for scepticism, but the supporting evidence — a superb cast including Javier Bardem and Penélope Cruz in a small but pivotal role — gives one reason to believe.</p>

<h2>The Palme d'Or Prediction</h2>
<p>The jury, headed this year by Alfonso Cuarón, has a reputation for adventurousness. My prediction for the Palme d'Or is <em>The Hours After</em>, with <em>Pacífico</em> as the runner-up. But Cannes has a way of humbling all predictions, and whoever screens last usually has the freshest impression in the jurors' minds when the deliberations begin.</p>`,
    category: entertainment,
    tags: ["Cannes", "film festival", "cinema", "movies", "awards"],
    author: amara,
    publishedAt: "2026-04-18T11:00:00Z",
    readingTime: 8,
    featuredImage: "/article-images/art-016-culture.svg",
    featuredImageAlt: "Film festival screening",
    isFeatured: false,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 28900,
    relatedArticleIds: ["art-017"],
  },
  {
    id: "art-017",
    title: "Taylor Swift's Eras Tour Film Crosses $2 Billion at Global Box Office",
    slug: "taylor-swift-eras-tour-film-2-billion-global-box-office",
    excerpt: "The concert film documenting Taylor Swift's record-breaking Eras Tour has become the highest-grossing concert film in history and one of the top-20 highest-grossing films of any genre ever made.",
    content: `<p>Taylor Swift's <em>The Eras Tour</em> concert film crossed the $2 billion mark at the global box office this week, cementing its position as the highest-grossing concert film in history by a margin so large it has effectively rendered all previous records academic, and ranking it among the top-20 highest-grossing films of any genre ever produced.</p>

<p>The film, which documents Swift's record-breaking Eras Tour — the highest-grossing concert tour in history — was initially released in October 2023 in a distribution deal that bypassed major studios entirely. It has since been re-released four times with additional footage from different legs of the tour, and each re-release has driven new surges of ticket sales.</p>

<h2>The Economics of the Swifties</h2>
<p>The film's commercial achievement illuminates something significant about the relationship between Swift and her fanbase. In surveys conducted by entertainment researchers, a substantial proportion of ticket buyers have seen the film multiple times — in some cases more than ten — a pattern of engagement that is virtually unprecedented in theatrical distribution history.</p>

<p>"What Swift has built isn't a fanbase in the traditional sense," said Dr. Amanda Petrov of the USC Annenberg School for Communication and Journalism. "It's something closer to a community of practice, with its own vocabulary, rituals, and collective experiences. The film functions as one of those collective experiences."</p>

<h2>Industry Implications</h2>
<p>The film's success has prompted serious reconsideration within the entertainment industry of the relationship between touring artists and theatrical distribution. Several major labels and talent agencies are now in discussions with theatre chains about dedicated concert film programmes, and at least two other major artists are planning theatrical releases of their tour documentation in 2026.</p>`,
    category: entertainment,
    tags: ["Taylor Swift", "Eras Tour", "box office", "concert film", "music"],
    author: amara,
    publishedAt: "2026-04-16T15:30:00Z",
    readingTime: 5,
    featuredImage: "/article-images/art-017-culture.svg",
    featuredImageAlt: "Concert stage with lights",
    isFeatured: false,
    isTrending: false,
    isMostRead: true,
    isBreaking: false,
    status: "published",
    views: 115600,
    relatedArticleIds: ["art-016"],
  },

  // ─── OPINION ───────────────────────────────────────────────────────────────
  {
    id: "art-018",
    title: "Opinion: The West's Approach to China Is Neither Strategy Nor Principle",
    slug: "opinion-west-approach-china-neither-strategy-principle",
    excerpt: "Neither full engagement nor true containment, the current policy of selective competition and selective cooperation pleases no one, deters nothing, and leaves the international order more uncertain than ever.",
    content: `<p>When historians look back on this decade's Western policy toward China, they may be struck less by the decisions that were made than by the chronic inability to decide. What passes for China strategy in Washington, Brussels, and most Western capitals today is neither the full economic integration that characterised the 1990s and 2000s, nor a coherent strategy of competitive deterrence. It is a holding position dressed up in the language of strategy.</p>

<p>Consider the accumulation of contradictions. Western governments have imposed unprecedented technology export controls on China, citing national security — while simultaneously deepening supply chain dependencies in sectors from pharmaceuticals to rare earths that those same governments acknowledge to be strategically critical. They declare Taiwan's security a core interest and then argue among themselves about whether that interest is worth the risk of defending. They build new trade coalitions in the Indo-Pacific and then fail to ratify the agreements those coalitions are supposed to anchor.</p>

<h2>The Cost of Ambiguity</h2>
<p>Ambiguity has genuine tactical uses in diplomacy. Constructive ambiguity — the calculated refusal to clarify a position — has been a tool of statecraft since Bismarck. But the ambiguity on display in current Western China policy is not constructive. It does not serve a purpose. It is the residue of domestic political difficulty: the difficulty of asking publics to accept the costs of genuine containment, and the difficulty of asking strategic communities to accept the costs of genuine engagement.</p>

<p>The result pleases no one. Businesses cannot plan around a policy that might restrict their China operations next year or might not. Allies in Asia cannot build security architecture around a commitment that is hedged to the point of meaninglessness. China's leadership, for its part, reads the ambiguity as both invitation and cover — an invitation to test the limits of Western tolerance, and cover for doing so without triggering a clear response.</p>

<h2>A Choice, Not a Glide Path</h2>
<p>What is required is not a new theory but the political will to make a choice and sustain it. The choice between engagement and competition is genuinely difficult, with legitimate arguments on multiple sides. But the present arrangement — refusing to choose, accruing the costs of both paths simultaneously, and calling the result a strategy — is no longer sustainable. The world is reorganising itself around the fact of great-power competition whether the West is ready to engage with that fact or not.</p>`,
    category: opinion,
    tags: ["China", "geopolitics", "US foreign policy", "opinion", "international relations"],
    author: david,
    publishedAt: "2026-04-19T07:00:00Z",
    readingTime: 6,
    featuredImage: "/article-images/art-018-opinion.svg",
    featuredImageAlt: "Geopolitical global map",
    isFeatured: false,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 19800,
    relatedArticleIds: ["art-001", "art-005"],
  },
  {
    id: "art-019",
    title: "Opinion: AI Is Not Coming for Your Job — It's Coming for Your Manager's Job",
    slug: "opinion-ai-not-coming-job-managers-job",
    excerpt: "The displacement effects of artificial intelligence are being misread. The evidence points not to mass unemployment among knowledge workers, but to the hollowing out of the managerial middle — with consequences nobody is fully prepared for.",
    content: `<p>Every significant technological wave generates a predictable panic about the jobs it will destroy. The industrial revolution would render artisans obsolete. Automation would eliminate factory workers. Computers would end the need for clerks. In each case, the feared displacement happened — but never quite in the way that was feared, and always accompanied by the creation of new categories of work that nobody had predicted.</p>

<p>The conversation about AI and employment is following the same script. The most common fear — that AI will eliminate routine cognitive tasks, throwing millions of office workers into unemployment — is not wrong, exactly, but it is focused on the wrong stratum of the workforce. The real disruption may be happening somewhere else entirely: in the middle layers of organizational management.</p>

<h2>What Managers Actually Do</h2>
<p>To understand why, it helps to think clearly about what management is actually for. The core function of organizational hierarchy is to coordinate information and make decisions in conditions of uncertainty. Managers exist, in large part, to serve as nodes in information networks: aggregating reports from below, synthesising them, and passing decisions downward or recommendations upward.</p>

<p>This is, as it turns out, almost exactly what large language models are very good at. The same capabilities that allow an AI to summarise a lengthy document, extract the key decisions, and draft a response memo are the capabilities that constitute a large fraction of what middle managers do every day. And unlike the elimination of individual contributor tasks — where the human's work is simply not done, or done differently — the elimination of managerial coordination layers does not remove a product from the workflow. It removes an overhead cost.</p>

<h2>The Consequences</h2>
<p>If this analysis is right, the employment consequences of AI will not look like a mass unemployment event among knowledge workers. They will look like a slow, structural compression of organizational hierarchies, playing out over years rather than months, affecting people in their late careers more than their early ones, and concentrated in industries where the coordination overhead of large organisations has historically been highest: financial services, consulting, insurance, large enterprise technology.</p>`,
    category: opinion,
    tags: ["AI", "employment", "management", "future of work", "opinion"],
    author: marcus,
    publishedAt: "2026-04-17T08:00:00Z",
    readingTime: 7,
    featuredImage: "/article-images/art-019-opinion.svg",
    featuredImageAlt: "Office meeting and management",
    isFeatured: false,
    isTrending: true,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 47300,
    relatedArticleIds: ["art-008", "art-015"],
  },
  {
    id: "art-020",
    title: "Scientists Discover Mechanism Behind Tardigrade's Near-Indestructibility",
    slug: "scientists-discover-mechanism-tardigrade-indestructibility",
    excerpt: "Researchers have identified the specific protein complex that allows tardigrades to survive vacuum, radiation, and extreme temperatures, opening potential applications in medicine and materials science.",
    content: `<p>A team of researchers at the University of Stuttgart has identified the molecular mechanism that allows tardigrades — the microscopic animals sometimes called "water bears" — to survive conditions that would instantly kill any other known animal, including the vacuum of space, ionizing radiation doses thousands of times the lethal human level, and temperatures ranging from near absolute zero to 150 degrees Celsius.</p>

<p>The mechanism, described in a paper published Wednesday in the journal Cell, centres on a family of proteins unique to tardigrades that the researchers have named Tardigrade-specific Intrinsically Disordered Proteins, or TDPs. When tardigrades are exposed to extreme stress conditions, TDPs rapidly coat and immobilize the animal's cellular machinery in a glass-like substance, essentially pausing all biological activity without damaging it.</p>

<h2>The Science of Suspended Animation</h2>
<p>What makes the Stuttgart team's findings particularly significant is their detailed characterisation of how TDPs selectively interact with different cellular components. The proteins appear to have evolved binding specificity that prioritizes protecting the most functionally critical and hardest-to-replace cellular structures — DNA, ribosomes, mitochondria — while allowing more easily replaced components to be sacrificed.</p>

<p>"It's as if evolution has given these animals a very sophisticated triage system," said lead researcher Dr. Katrin Hoffmann. "The cell doesn't try to preserve everything. It figures out what absolutely cannot be lost, and it protects only that."</p>

<h2>Potential Applications</h2>
<p>The most immediately obvious potential application is in the preservation of biological materials — vaccines, blood products, transplant organs — that currently require cold-chain logistics because of their sensitivity to temperature fluctuations. If TDP-based treatments could confer some fraction of tardigrade-like resilience, the logistics of global healthcare delivery could be transformed.</p>

<p>Longer-term speculative applications discussed in the paper include radiation-protective treatments for cancer patients and space travellers, and potentially — the researchers are careful to note this is highly speculative — some form of induced suspended animation for surgical or trauma applications in humans.</p>`,
    category: science,
    tags: ["tardigrade", "biology", "science", "proteins", "discovery"],
    author: sofia,
    publishedAt: "2026-04-16T10:00:00Z",
    readingTime: 6,
    featuredImage: "/article-images/art-020-science.svg",
    featuredImageAlt: "Scientific microscopy research",
    isFeatured: false,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 38100,
    relatedArticleIds: ["art-014", "art-015"],
  },
  {
    id: "art-021",
    title: "Nigeria Becomes Africa's First Country to Fully Implement Digital Currency System",
    slug: "nigeria-africa-first-country-fully-implement-digital-currency",
    excerpt: "Nigeria's central bank has announced the completion of a nationwide rollout of the eNaira digital currency system, making it the first African nation to operate a fully functional central bank digital currency at scale.",
    content: `<p>LAGOS — Nigeria has become the first country on the African continent to complete a nationwide rollout of a central bank digital currency, the Central Bank of Nigeria announced Monday, marking a milestone in both the country's financial modernisation effort and the global experiment with state-backed digital money.</p>

<p>The eNaira, first piloted in 2021, has gone through three major revisions based on adoption data and user feedback. The current iteration integrates with mobile money platforms used by an estimated 85 million Nigerians and can be used for transactions ranging from street vendor payments to government benefit disbursements without requiring a bank account.</p>

<h2>Financial Inclusion as the Goal</h2>
<p>The primary driver of Nigeria's investment in the eNaira has been financial inclusion. Despite being Africa's largest economy, Nigeria has historically had a substantial unbanked population — people without access to formal financial services — estimated at more than 38 million adults before the eNaira rollout began. The Central Bank says that figure has fallen to under 12 million, though independent analysts caution that "access" and "regular use" are different metrics.</p>

<p>"What we have built is infrastructure," said CBN Governor Folake Adeyemi. "The same way the road exists whether you drive on it or not, the eNaira exists for every Nigerian, ready to use the moment they need it."</p>

<h2>International Implications</h2>
<p>Nigeria's experience will be closely watched by the 60-plus other countries currently developing or piloting CBDCs. The country's scale — 220 million people — and the diversity of its economic landscape make it a more meaningful test case than smaller pilots conducted elsewhere.</p>`,
    category: business,
    tags: ["Nigeria", "CBDC", "digital currency", "Africa", "fintech"],
    author: james,
    publishedAt: "2026-04-15T13:00:00Z",
    readingTime: 6,
    featuredImage: "/article-images/art-021-business.svg",
    featuredImageAlt: "Digital currency and finance",
    isFeatured: false,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 22100,
    relatedArticleIds: ["art-006", "art-007"],
  },
  {
    id: "art-022",
    title: "Formula One's New Regulations Produce Closest Season in Two Decades",
    slug: "formula-one-new-regulations-closest-season-two-decades",
    excerpt: "Five different winners in the first six races of the Formula One season has prompted comparisons to 2012, the last time the championship was genuinely open entering the second half of the year.",
    content: `<p>Six races into the Formula One season, no driver has won more than twice, the championship lead has changed hands after every race, and three different constructors have stood on the top step of the podium. For a sport that spent the better part of a decade watching the same cars and drivers win with almost metronomic regularity, it is a state of affairs that feels both disorienting and exhilarating.</p>

<p>The revolution in the standings is a direct consequence of regulatory changes introduced this season that were designed precisely to achieve this outcome: a new technical formula that has reset the performance hierarchy and given smaller teams genuine competitive opportunities for the first time in years.</p>

<h2>The New Cars</h2>
<p>The 2026 technical regulations introduced radically smaller cars with more powerful hybrid systems, reducing downforce dependence and increasing the importance of driver skill in the wet and in close-proximity racing. The new power unit regulations also introduced a 50-50 split between internal combustion and electrical power output, increasing the significance of energy management as a tactical variable.</p>

<p>The unintended consequence — or perhaps the fully intended consequence — has been to mix up a performance hierarchy that had become deeply entrenched. McLaren and Ferrari have emerged as the early-season front-runners, with Red Bull, Mercedes, and the improved Aston Martin operation all capable of winning on the right circuit.</p>

<h2>The Championship Contenders</h2>
<p>Lando Norris leads the drivers' championship by seven points from Ferrari's Charles Leclerc, with Max Verstappen a further twelve behind in third. The gap between first and fifth is smaller at this point in the season than it has been since 2012, when seven different drivers won the first seven races en route to Sebastian Vettel's dramatic late-season title charge.</p>`,
    category: sports,
    tags: ["Formula One", "F1", "motorsport", "Norris", "Leclerc"],
    author: tomas,
    publishedAt: "2026-04-14T16:00:00Z",
    readingTime: 5,
    featuredImage: "/article-images/art-022-sports.svg",
    featuredImageAlt: "Formula One racing car on track",
    isFeatured: false,
    isTrending: false,
    isMostRead: false,
    isBreaking: false,
    status: "published",
    views: 34600,
    relatedArticleIds: ["art-010", "art-011"],
  },
];

// ── M-9 fix: Write-time sanitization ─────────────────────────────────────────
//
// Stamp every article with a `sanitizedContent` field immediately after the
// array literal is closed.  This mirrors what a CMS save hook would do on
// write: sanitization runs once at module-load / build time rather than on
// every render request.
//
// Render path (app/news/[category]/[slug]/page.tsx) and every secondary read
// path (RSS, JSON-LD descriptions, search snippets) MUST prefer
// `sanitizedContent` over `content`.  Falling back to
// sanitizeArticleContent(article.content) is acceptable only when
// `sanitizedContent` is absent — typically during a migration window — but
// should be treated as a code smell and resolved promptly.
//
// L-3 fix: that fallback now lives in toPublicArticle() below, rather than
// being duplicated at each render call site. toPublicArticle() also strips
// the raw `content` field from the object it returns (PublicArticle), so
// page-level code only ever sees the guaranteed-present `sanitizedContent`.
//
// When migrating to MongoDB:
//   1. Run this same sanitization in the CMS save hook and store the result
//      as `sanitizedContent` in the document.
//   2. Ensure MongoDB queries project `sanitizedContent` alongside `content`
//      (never project `content` without `sanitizedContent`).
//   3. Remove this module-level loop once the DB is the source of truth.
//
// ── SECONDARY READ PATHS — must use sanitizedContent ────────────────────────
// The following code paths currently do NOT render article.content as HTML,
// but any future change that does MUST use sanitizedContent, not content:
//
//   • app/rss.xml/route.ts          — uses a.excerpt (safe plain text)
//   • app/sitemap.xml/route.ts      — uses slugs/dates only (no HTML)
//   • searchArticles()              — searches title/excerpt/tags (no HTML)
//   • app/news/[category]/[slug]/page.tsx → JSON-LD `description`
//                                      — uses a.excerpt (safe plain text)
//
// If any of these paths is extended to include body HTML (e.g. RSS
// full-content feed, JSON-LD articleBody), switch to article.sanitizedContent.
// ─────────────────────────────────────────────────────────────────────────────
for (const article of _rawArticles) {
  (article as Article).sanitizedContent = sanitizeArticleContent(article.content);
}

// ─── H-1 fix: unexported internal array + typed accessor exports ─────────────
//
// The raw Article[] is no longer exported directly. Exporting it was a
// structural hazard: any future caller that imported `articles` and forwarded
// objects to a component or JSON response without calling toPublicArticle()
// would silently leak author.email. The TypeScript type system provides no
// guard — Article structurally satisfies most consumers expecting
// PublicArticle-shaped data, so the compiler would not catch it.
//
// WHAT REPLACES IT
// ────────────────
// `_articles` (this constant) — module-private. Used only by the getter
//   functions defined in this file, all of which call toPublicArticle()
//   before returning. No caller outside this module can access raw Article
//   objects.
//
// `getPublishedSlugs()` — returns string[] for generateStaticParams in
//   app/article/[slug]/page.tsx and app/news/[category]/[slug]/page.tsx.
//   Returns only slug (and category.slug) — no Article object escapes.
//
// `getPublishedArticles()` — returns PublicArticle[] for callers that need
//   the full list: prev/next navigation in app/news/[category]/[slug]/page.tsx,
//   sitemap.xml (updatedAt/publishedAt via PublicArticle fields), and
//   bookmarks/actions.ts (article lookup by id).
//
// `getPublishedArticlesRaw()` — returns a minimal projection of only the
//   fields needed by sitemap.xml (slug, category.slug, updatedAt, publishedAt).
//   This lets sitemap.xml avoid importing toPublicArticle and the full
//   PublicArticle type when all it needs are URL and date fields.
//
// Every existing getter (getArticleBySlug, getArticlesByCategory, etc.) is
// already correct — they all filter and call toPublicArticle() internally.
// This change just closes the raw-export door so no future caller can
// accidentally bypass those protections.
//
// ── MongoDB migration note ───────────────────────────────────────────────────
// When migrating to MongoDB, delete `_articles` and all the in-memory
// functions below. Replace with async DB-backed equivalents that include
// `{ projection: withArticleProjection }` on every query and call
// toPublicArticle() on every result as defence-in-depth.
const _articles: Article[] = _rawArticles as Article[];

// ---------------------------------------------------------------------------
// H-1 fix: typed accessor functions that replace the raw `articles` export
// ---------------------------------------------------------------------------

/**
 * Returns `{ slug }` pairs for every published article.
 * Used by generateStaticParams in app/article/[slug]/page.tsx only.
 * Returns plain strings — no Article or PublicArticle object escapes.
 */
export function getPublishedSlugs(): { slug: string }[] {
  return _articles
    .filter((a) => a.status === "published")
    .map((a) => ({ slug: a.slug }));
}

/**
 * Returns `{ category, slug }` pairs for every published article.
 * Used by generateStaticParams in app/news/[category]/[slug]/page.tsx only.
 * Returns plain strings — no Article or PublicArticle object escapes.
 */
export function getPublishedCategorySlugs(): { category: string; slug: string }[] {
  return _articles
    .filter((a) => a.status === "published")
    .map((a) => ({ category: a.category.slug, slug: a.slug }));
}

/**
 * Returns all published articles as PublicArticle[] (author.email stripped).
 *
 * Used by:
 *   • app/news/[category]/[slug]/page.tsx — prev/next navigation
 *   • app/bookmarks/actions.ts            — bookmark ID lookup
 *
 * The array is in insertion order (not sorted). Callers that need a specific
 * order should sort the result themselves.
 */
export function getPublishedArticles(): PublicArticle[] {
  return _articles
    .filter((a) => a.status === "published")
    .map(toPublicArticle);
}

/**
 * Returns a minimal projection of published articles for sitemap.xml.
 * Only the fields needed by the sitemap are included — slug, category.slug,
 * updatedAt, publishedAt — so the route never receives a full Article or
 * PublicArticle object, making it impossible to accidentally expose
 * author.email even without calling toPublicArticle().
 */
export function getPublishedArticlesForSitemap(): {
  slug: string;
  categorySlug: string;
  updatedAt?: string;
  publishedAt: string;
}[] {
  return _articles
    .filter((a) => a.status === "published")
    .map((a) => ({
      slug: a.slug,
      categorySlug: a.category.slug,
      updatedAt: a.updatedAt,
      publishedAt: a.publishedAt,
    }));
}

// ─── H-3 fix: slug-uniqueness guard ─────────────────────────────────────────
//
// /article/[slug] (app/article/[slug]/page.tsx) looks up an article by slug
// ALONE — it has no category segment to disambiguate, unlike the canonical
// /news/[category]/[slug] route. getArticleBySlug() below therefore assumes
// `slug` is globally unique across every category, not merely unique within
// a category.
//
// That assumption holds trivially today: this hardcoded array is small and
// every slug here was authored to be globally unique. It stops holding the
// moment two articles in different categories are independently given the
// same slug — entirely plausible once a CMS lets multiple editors create
// content without visibility into each other's slug choices. If that ever
// happens, getArticleBySlug() (and therefore /article/[slug]) will silently
// resolve to whichever article happens to appear first in `articles`, with
// no error and no signal that the wrong article was served.
//
// This loop fails the build immediately if that invariant is ever violated,
// rather than letting it surface later as a confusing wrong-article bug in
// production.
//
// When migrating to a CMS / MongoDB, replace this with a unique index on the
// `slug` field (e.g. `db.collection("articles").createIndex({ slug: 1 },
// { unique: true })`) and a save-hook validation step, so the constraint is
// enforced at write time rather than re-checked at every module load.
{
  const seenSlugs = new Map<string, string>(); // slug -> first article id seen
  for (const article of _articles) {
    const existing = seenSlugs.get(article.slug);
    if (existing) {
      throw new Error(
        `[lib/articles.ts] Duplicate slug "${article.slug}" found on articles ` +
          `"${existing}" and "${article.id}". Slugs must be globally unique — ` +
          `/article/[slug] looks up by slug alone (no category segment) and ` +
          `cannot disambiguate between articles that share a slug across ` +
          `categories. Rename one of the slugs, or, when migrating to a CMS, ` +
          `enforce a unique index on the slug field.`
      );
    }
    seenSlugs.set(article.slug, article.id);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a published article by its URL slug.
 *
 * Drafts are intentionally excluded: callers (article page, generateMetadata)
 * must never receive a draft object, even incidentally.  If a slug exists but
 * the article is not published, this returns `undefined` — the caller treats
 * it the same as a missing article and issues a 404 / noindex response.
 *
 * H-3 note: this performs a GLOBAL slug lookup with no category
 * disambiguation, because /article/[slug] (its primary caller) has no
 * category segment in its URL. The module-load guard above enforces that
 * `slug` is unique across `articles` so this lookup cannot silently resolve
 * to the wrong article. See the H-3 fix comment block above.
 */
export const getArticleBySlug = (slug: string): PublicArticle | undefined => {
  const article = _articles.find((a) => a.slug === slug && a.status === "published");
  return article ? toPublicArticle(article) : undefined;
};

export const getArticlesByCategory = (categorySlug: string): PublicArticle[] => {
  return _articles
    .filter((a) => a.category.slug === categorySlug && a.status === "published")
    .map(toPublicArticle);
};

export const getFeaturedArticles = (): PublicArticle[] => {
  return _articles
    .filter((a) => a.isFeatured && a.status === "published")
    .map(toPublicArticle);
};

export const getTrendingArticles = (): PublicArticle[] => {
  return _articles
    .filter((a) => a.isTrending && a.status === "published")
    // M-5: `views` is a hardcoded seed value used as a stable sort key only.
    // Secondary sort on publishedAt breaks ties deterministically so the order
    // is stable across JS engine versions and does not depend on insertion order.
    // When migrating to MongoDB, replace both sort keys with a live view-count
    // field and a timestamp from the article_views collection.
    .sort((a, b) => {
      const viewDiff = (b.views ?? 0) - (a.views ?? 0);
      if (viewDiff !== 0) return viewDiff;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    })
    // M-1 fix: toPublicArticle() itself now strips `views` (see its
    // definition below), so the per-call-site `{ views: _views, ...rest }`
    // destructure that used to live here is redundant and has been removed.
    // The .sort() above still reads `a.views`/`b.views` off the raw
    // `Article[]` *before* this .map() runs, so the sort key is unaffected —
    // only the object handed back to callers changes.
    .map(toPublicArticle);
};

export const getMostReadArticles = (): PublicArticle[] => {
  return _articles
    .filter((a) => a.isMostRead && a.status === "published")
    // M-5: same note as getTrendingArticles above — `views` is synthetic.
    // Secondary sort on publishedAt ensures a stable, deterministic top-5
    // even when two articles have the same hardcoded view count.
    .sort((a, b) => {
      const viewDiff = (b.views ?? 0) - (a.views ?? 0);
      if (viewDiff !== 0) return viewDiff;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    })
    .slice(0, 5)
    // M-1 fix: see getTrendingArticles() above — toPublicArticle() now
    // strips `views` itself, so the redundant per-call-site destructure
    // that lived here previously has been removed.
    .map(toPublicArticle);
};

export const getLatestArticles = (limit = 10): PublicArticle[] => {
  return [..._articles]
    .filter((a) => a.status === "published")
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
    .slice(0, limit)
    .map(toPublicArticle);
};

export const getBreakingArticles = (): PublicArticle[] => {
  return _articles
    .filter((a) => a.isBreaking && a.status === "published")
    .map(toPublicArticle);
};

export const getRelatedArticles = (articleId: string): PublicArticle[] => {
  const article = _articles.find((a) => a.id === articleId);
  if (!article || !article.relatedArticleIds) return [];
  // Exclude drafts — related articles must be published before surfacing to readers.
  return _articles
    .filter(
      (a) => article.relatedArticleIds!.includes(a.id) && a.status === "published"
    )
    .map(toPublicArticle);
};

export const getArticlesByAuthor = (authorSlug: string): PublicArticle[] => {
  return _articles
    .filter((a) => a.author.slug === authorSlug && a.status === "published")
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
    .map(toPublicArticle);
};

/**
 * Convert a raw tag string into the URL-safe slug used by /tag/[slug].
 *
 * Mirrors the inline slugification already used for the tag links rendered
 * on the article page (lowercase, whitespace → hyphen). Centralised here so
 * the link-generation site (app/article/[slug]/page.tsx) and the lookup
 * site (getArticlesByTag / getTagLabel below) can never drift apart.
 */
export function tagToSlug(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Look up published articles carrying a given tag, matched by slug rather
 * than exact string — both sides are normalised through tagToSlug() so the
 * comparison is case-insensitive and whitespace-insensitive.
 *
 * Sorted newest-first, mirroring getArticlesByAuthor()'s ordering.
 */
export const getArticlesByTag = (tagSlug: string): PublicArticle[] => {
  return _articles
    .filter(
      (a) =>
        a.status === "published" &&
        a.tags.some((t) => tagToSlug(t) === tagSlug)
    )
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
    .map(toPublicArticle);
};

/**
 * Returns the canonical display label for a tag slug — the original-cased
 * tag string as written on the first published article that carries it —
 * or undefined if no published article uses this tag.
 *
 * Tags are not stored as a separate entity with their own name + slug, so
 * the display label is derived from usage. Existing tag data is consistently
 * cased across articles (e.g. "AI" and "EU" never appear in conflicting
 * casings), so the first match is a safe, deterministic choice.
 */
export const getTagLabel = (tagSlug: string): string | undefined => {
  for (const a of _articles) {
    if (a.status !== "published") continue;
    const match = a.tags.find((t) => tagToSlug(t) === tagSlug);
    if (match) return match;
  }
  return undefined;
};

/**
 * Unique tag slugs across all published articles — used by
 * app/tag/[slug]/page.tsx's generateStaticParams().
 */
export const getAllTagSlugs = (): string[] => {
  const slugs = new Set<string>();
  for (const a of _articles) {
    if (a.status !== "published") continue;
    for (const t of a.tags) slugs.add(tagToSlug(t));
  }
  return Array.from(slugs);
};

/**
 * Strip the internal `email` field from an author before the article
 * crosses the server->client boundary.  Returns a `PublicArticle` that
 * is safe to pass to Client Components, Server Actions, and API routes.
 *
 * ── H-4 fix: definition-site application ─────────────────────────────────────
 *
 * All public query functions (getArticleBySlug, getArticlesByCategory,
 * getFeaturedArticles, getTrendingArticles, getMostReadArticles,
 * getLatestArticles, getBreakingArticles, getRelatedArticles,
 * getArticlesByAuthor, searchArticles) now call toPublicArticle() internally
 * and return PublicArticle / PublicArticle[] instead of Article / Article[].
 *
 * This makes `author.email` structurally impossible to leak from a query
 * function: the type system enforces it at every call site without any caller
 * needing to remember to apply the strip.
 *
 * toPublicArticle() remains exported for callers that need to convert a
 * raw Article obtained from within this module (e.g. future CMS integration
 * code) to a PublicArticle. All current callers of getPublishedArticles()
 * already receive PublicArticle[] and do not need to call toPublicArticle()
 * again.
 *
 * ── M-6: MongoDB projection requirement (DB migration) ───────────────────────
 *
 * This application-layer strip is defence-in-depth.  It is NOT sufficient
 * as the sole guard when articles come from MongoDB.
 *
 * When migrating to MongoDB, add a field-exclusion projection on EVERY query
 * that returns article documents, so `author.email` is never fetched from the
 * database in the first place:
 *
 *   db.collection("articles").findOne(
 *     { slug, status: "published" },
 *     { projection: { "author.email": 0 } }   ← primary guard
 *   );
 *
 * Apply this projection to ALL article queries:
 *   • findOne (article page, generateMetadata)
 *   • find    (category listing, author page, home page, archive, RSS)
 *   • aggregate pipelines that $lookup or $unwind authors
 *
 * This function MUST still be called after every DB read as defence-in-depth —
 * it catches any field that slips through a misconfigured projection — but it
 * should never be the only line of defence.
 * ── M-1 fix: `views` now stripped here too ───────────────────────────────────
 *
 * `types/index.ts` documents `views` as "intentionally absent from all
 * public-facing components," but until this fix only getTrendingArticles()
 * and getMostReadArticles() actually removed it (via a per-call-site
 * `{ views: _views, ...rest }` destructure) before calling this function.
 * Every other public query — getArticleBySlug, getArticlesByCategory,
 * getFeaturedArticles, getLatestArticles, getBreakingArticles,
 * getRelatedArticles, getArticlesByAuthor, searchArticles — called
 * toPublicArticle() directly and shipped the real hardcoded `views` number
 * into the RSC flight payload for every article page, home page, category
 * page, archive, and author page.
 *
 * `views` is now stripped unconditionally below, so the strip lives in the
 * one function every public query already funnels through, instead of
 * depending on each call site remembering to repeat it. The now-redundant
 * destructures in getTrendingArticles()/getMostReadArticles() have been
 * removed accordingly — see those functions above.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function toPublicArticle(article: Article): PublicArticle {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { email: _email, ...publicAuthor } = article.author;

  // L-3 fix: previously `{ ...article, author: publicAuthor }` carried the
  // raw, pre-sanitization `content` field across the server -> client
  // boundary alongside `sanitizedContent`, even though only
  // `sanitizedContent` is ever rendered (via dangerouslySetInnerHTML). Not
  // an XSS path — React/Next never executes the unused field — but
  // unnecessary exposure of source HTML in the RSC flight payload / page
  // source, worth closing off before `content` becomes CMS/editor-authored
  // rather than hardcoded.
  //
  // Fix: drop both `content` and `sanitizedContent` from the spread below,
  // then recompute `sanitizedContent` here so it is guaranteed present on
  // the returned PublicArticle (see the type comment on PublicArticle in
  // types/index.ts). This also means callers no longer need their own
  // `article.sanitizedContent ?? sanitizeArticleContent(article.content)`
  // fallback — this is now the single place that owns that logic.
  //
  // M-1 fix: also drop `views` here (see the M-1 note above this function).
  // It is destructured out and intentionally left unused — `_views` is
  // never read again — purely to keep it out of `rest`/the returned object.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content, sanitizedContent, views: _views, ...rest } = article;

  return {
    ...rest,
    author: publicAuthor,
    sanitizedContent: sanitizedContent ?? sanitizeArticleContent(content),
  };
}

// ---------------------------------------------------------------------------
// S-3 fix: MongoDB base query projection — PRIMARY guard for author.email
// ---------------------------------------------------------------------------

/**
 * Base MongoDB projection that MUST be spread into every article query.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `toPublicArticle()` strips `author.email` at the application layer, which
 * is correct as defence-in-depth.  But it cannot be the sole guard: a new
 * route, Server Action, or migration script that reads articles from MongoDB
 * and forgets to call `toPublicArticle()` will silently include staff email
 * addresses in the RSC flight payload, a JSON response body, or a log line
 * visible in browser DevTools.
 *
 * A DB-level projection makes leakage structurally impossible — `author.email`
 * is never fetched from MongoDB in the first place, so it cannot appear in any
 * downstream serialisation regardless of whether `toPublicArticle()` is called.
 *
 * HOW TO USE (MongoDB migration)
 * ──────────────────────────────
 * Spread this object into the `projection` option of every article query:
 *
 *   import { withArticleProjection, toPublicArticle } from "@/lib/articles";
 *
 *   // findOne
 *   const raw = await db.collection("articles").findOne(
 *     { slug, status: "published" },
 *     { projection: withArticleProjection }
 *   );
 *
 *   // find (list queries)
 *   const raws = await db.collection("articles")
 *     .find({ status: "published" })
 *     .project(withArticleProjection)
 *     .toArray();
 *
 *   // aggregate: add as a $project stage at the start of the pipeline
 *   const raws = await db.collection("articles").aggregate([
 *     { $match: { status: "published" } },
 *     { $project: withArticleProjection },
 *     // … further stages …
 *   ]).toArray();
 *
 * Apply it to ALL queries that may return article documents:
 *   • findOne (article page, generateMetadata, RSS item)
 *   • find    (category listing, author page, home page, archive, trending)
 *   • aggregate pipelines that $lookup or $unwind authors
 *
 * `toPublicArticle()` MUST still be called on every result as defence-in-depth
 * — it catches any field that slips through a misconfigured or forgotten
 * projection.  Neither guard replaces the other; both must be present.
 *
 * WHAT IS EXCLUDED
 * ────────────────
 * Only `author.email` is excluded here.  Do not add `_id: 0` to this object
 * — the MongoDB driver and TypeScript types expect `_id` to be present unless
 * the caller explicitly opts out.  Add further field exclusions only when a
 * concrete privacy or performance requirement justifies them.
 */
export const withArticleProjection = {
  "author.email": 0,
} as const;

/**
 * Escapes all regex metacharacters in a user-supplied string so it is safe
 * to use inside a RegExp constructor or a MongoDB `{ $regex: ... }` query.
 *
 * Without escaping, a string like `.*.*.*.*` becomes a catastrophic
 * backtracking pattern (ReDoS), and a string like `(?<=foo)bar` can expose
 * engine behaviour that leaks timing information.  Characters like `$` and
 * `{` can also act as MongoDB operator injection vectors when the value is
 * passed directly into a query object.
 *
 * This function MUST be called on every user-supplied string before it is
 * used in:
 *   • new RegExp(query)
 *   • MongoDB { $regex: query }          ← DB migration path
 *   • Any other regex-based filter
 *
 * ⚠️  Do NOT call this for in-memory `.includes()` searches.  Escaping turns
 * "C++" into "C\+\+", "(test)" into "\(test\)", and "node.js" into
 * "node\.js" — backslash sequences that will never appear in article text,
 * causing valid queries to return false negatives.  Use the raw normalised
 * query (trimmed.toLowerCase()) with .includes() instead.
 *
 * ⚠️  DB MIGRATION NOTE (DB-1):
 * When migrating searchArticles to MongoDB, do NOT use:
 *   { title: { $regex: query, $options: "i" } }   ← ReDoS + injection risk
 *
 * Instead use MongoDB $text search with a text index:
 *   db.articles.createIndex({ title: "text", excerpt: "text", tags: "text" })
 *   db.articles.find({ $text: { $search: query } })
 *
 * $text search is immune to ReDoS and injection because it tokenises the
 * query into words rather than interpreting it as a regex.  If $regex is
 * unavoidable for a specific use-case, pass escapeSearchQuery(query) and
 * set a hard length cap on the input (MAX_QUERY_LENGTH below).
 */
export function escapeSearchQuery(raw: string): string {
  // Replace every regex metacharacter with its escaped equivalent.
  // The set covers all characters that are special in both JS RegExp
  // and MongoDB $regex (PCRE superset).
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Finding 8 fix: MAX_QUERY_LENGTH moved to lib/search-constants.ts (no
// `import "server-only"`) so it can be shared with Client Components and
// the /api/search route without importing this server-only module.
// Imported and re-exported here so: (a) searchArticles() can use it locally,
// and (b) all existing import sites (app/search/page.tsx etc.) remain unchanged.
import { MAX_QUERY_LENGTH } from "@/lib/search-constants";
export { MAX_QUERY_LENGTH };

/**
 * Search published articles by matching against the lightweight index
 * fields only (title, excerpt, tags, category name, author name).
 *
 * The full `content` field is intentionally excluded: it can be tens of
 * kilobytes of HTML per article and scanning it in-memory on every
 * request is O(n × |content|) — too expensive as the article count grows.
 * If full-text search over body copy is needed in the future, build a
 * proper inverted index or delegate to a search service (e.g. Algolia,
 * Typesense, or a MongoDB $text index).
 *
 * ⚠️  DB MIGRATION NOTE (DB-1 / M-2):
 * Replace this in-memory filter with a MongoDB $text search.  If $regex is
 * required, wrap the query with escapeSearchQuery() at that call site — it is
 * NOT applied here because it would cause false negatives for terms like
 * "C++", "(test)", and "node.js".  See the escapeSearchQuery() JSDoc above.
 *
 * 🚫 DO NOT translate this to:
 *     { $regex: query, $options: "i" }
 *   A naive regex port runs an unindexed full collection scan on every
 *   search request — there is no index that makes a leading-wildcard
 *   $regex fast at scale.
 *
 * ✅ USE INSTEAD:
 *     { $text: { $search: escapeSearchQuery(query) } }
 *   This requires the `article_text_search` text index, defined in
 *   createIndexes() (see lib/db.ts) and verified at startup. Before wiring
 *   this query, confirm `article_text_search` exists on the articles
 *   collection — db.articles.getIndexes() in mongosh, or check the
 *   startup index-verification log line.
 */
export const searchArticles = (query: string): PublicArticle[] => {
  // Enforce length cap before any processing — prevents O(n²) backtracking
  // in the current in-memory path and acts as a hard guard for the DB path.
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!trimmed) return [];

  // Use the raw normalised query for the in-memory .includes() path.
  // escapeSearchQuery() is intentionally NOT applied here: it backslash-
  // escapes regex metacharacters (e.g. "C++" → "C\+\+", "(test)" →
  // "\(test\)") that will never appear in article text, causing valid
  // queries like "C++", "node.js", or "(test)" to return false negatives.
  //
  // ⚠️  DB MIGRATION NOTE (DB-1 / M-2): when switching to MongoDB, do NOT
  // write `{ $regex: trimmed, $options: "i" }` here — it is an unindexed
  // full collection scan. Use `{ $text: { $search: escapeSearchQuery(trimmed) } }`
  // against the `article_text_search` index (see lib/db.ts createIndexes()),
  // and verify that index exists before shipping the migration.
  const q = trimmed.toLowerCase();

  return _articles
    .filter(
      (a) =>
        a.status === "published" &&
        (a.title.toLowerCase().includes(q) ||
          a.excerpt.toLowerCase().includes(q) ||
          a.category.name.toLowerCase().includes(q) ||
          a.author.name.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q)))
    )
    .map(toPublicArticle);
};
