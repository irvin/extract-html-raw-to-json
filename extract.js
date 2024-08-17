const cheerio = require('cheerio');
const fs = require('fs');

// 讀取 HTML 文件
const htmlContent = fs.readFileSync('index.html', 'utf8');
const $ = cheerio.load(htmlContent);

// 提取 <title> 標籤的內容
// const title = $('title').text();
// console.log(title);

// 提取 <meta name="description"> 標籤的內容
// const metaDescription = $('meta[name="description"]').attr('content');
// console.log(metaDescription);

// 提取 <script type="application/ld+json"> 標籤的內容
const jsonLdScript = $('script[type="application/ld+json"]').html();
const jsonLdData = JSON.parse(jsonLdScript);
// console.log(jsonLdData);

let res = {
  '@id': jsonLdData.mainEntityOfPage['@id'],
  articleSection: jsonLdData.articleSection,
  description: jsonLdData.description.trim(),
  dateModified: jsonLdData.dateModified,
  datePublished: jsonLdData.datePublished,
  headline: jsonLdData.headline,
  keywords: jsonLdData.keywords
}

// 提取 <script id="fusion-metadata" type="application/javascript"> 標籤的內容
let fuMetadata = $('script[id="fusion-metadata"]').html();

function extractRawHtmlContent(rawHtml) {
  const rawHtmlRegex = /"type"\s*:\s*"raw_html"[^}]*"content"\s*:\s*"([^"]*)"/g;
  let matches;
  const contents = [];

  while ((matches = rawHtmlRegex.exec(rawHtml)) !== null) {
      contents.push(matches[1]);
  }

  return contents;
}

// clean html tag in raw content
function removeHtmlTags(array) {
  const htmlTagRegex = /<[^>]*>/g;
  return array.map(item => item.replace(htmlTagRegex, ''));
}

res.raw_content = removeHtmlTags(extractRawHtmlContent(fuMetadata));

console.log(res);

const jsonString = JSON.stringify(res, null, 2);

fs.writeFile('index.json', jsonString, (err) => {
  if (err) {
    console.error('Error writing file', err);
  } else {
    console.log('Successfully wrote file');
  }
});