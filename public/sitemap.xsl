<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9">

  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>Sitemap — Faulter</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 15px; color: #111; background: #fafaf8; line-height: 1.6; }
          header { background: #111; color: #fff; border-bottom: 3px solid #C41E3A; }
          .header-inner { max-width: 1100px; margin: 0 auto; padding: 18px 24px; display: flex; align-items: baseline; gap: 20px; }
          .brand { font-family: Georgia, serif; font-size: 28px; font-weight: 900; color: #fff; text-decoration: none; letter-spacing: -0.5px; }
          .header-sub { font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }
          main { max-width: 1100px; margin: 0 auto; padding: 40px 24px 80px; }
          .page-title { font-family: Georgia, serif; font-size: 32px; font-weight: 800; color: #111; margin-bottom: 6px; }
          .page-meta { font-size: 13px; color: #888; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #111; }
          .page-meta strong { color: #C41E3A; }
          .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: #C41E3A; margin: 36px 0 12px; }
          table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e2e0; margin-bottom: 8px; }
          thead { background: #111; color: #fff; }
          thead th { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; }
          tbody tr { border-bottom: 1px solid #f0f0ee; }
          tbody tr:last-child { border-bottom: none; }
          tbody tr:hover { background: #fafaf8; }
          td { padding: 11px 14px; vertical-align: middle; }
          td a { color: #111; text-decoration: none; font-size: 14px; }
          td a:hover { color: #C41E3A; text-decoration: underline; text-underline-offset: 3px; }
          .badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 8px; text-transform: uppercase; letter-spacing: 1px; }
          .badge-daily   { background: #fef3f2; color: #C41E3A; border: 1px solid #fcd9d4; }
          .badge-weekly  { background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; }
          .badge-monthly { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
          .badge-yearly  { background: #fafaf8; color: #6b7280; border: 1px solid #e5e7eb; }
          .priority-bar { display: flex; align-items: center; gap: 8px; }
          .priority-track { flex: 1; height: 4px; background: #e5e7eb; max-width: 80px; }
          .priority-fill { height: 4px; background: #C41E3A; }
          .priority-num { font-size: 12px; color: #666; font-weight: 600; min-width: 24px; }
          .date-cell { font-size: 12px; color: #888; white-space: nowrap; }
          footer { max-width: 1100px; margin: 0 auto; padding: 0 24px 40px; font-size: 12px; color: #aaa; }
          footer a { color: #888; }
        </style>
      </head>
      <body>
        <header>
          <div class="header-inner">
            <a class="brand" href="/">Faulter</a>
            <span class="header-sub">XML Sitemap</span>
          </div>
        </header>
        <main>
          <h1 class="page-title">Sitemap</h1>
          <p class="page-meta">
            <strong><xsl:value-of select="count(sitemap:urlset/sitemap:url)"/></strong> URLs indexed ·
            This sitemap is read automatically by search engines including Google and Bing.
            <a href="/rss.xml" style="margin-left:8px;color:#C41E3A;">RSS Feed →</a>
          </p>

          <p class="section-label">Static Pages</p>
          <table>
            <thead>
              <tr>
                <th style="width:55%">URL</th>
                <th style="width:15%">Last Modified</th>
                <th style="width:15%">Update Frequency</th>
                <th style="width:15%">Priority</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sitemap:urlset/sitemap:url[not(contains(sitemap:loc, '/category/'))]">
                <xsl:sort select="sitemap:priority" order="descending" data-type="number"/>
                <xsl:call-template name="url-row"/>
              </xsl:for-each>
            </tbody>
          </table>

          <p class="section-label">Category Pages</p>
          <table>
            <thead>
              <tr>
                <th style="width:55%">URL</th>
                <th style="width:15%">Last Modified</th>
                <th style="width:15%">Update Frequency</th>
                <th style="width:15%">Priority</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sitemap:urlset/sitemap:url[contains(sitemap:loc, '/category/')]">
                <xsl:call-template name="url-row"/>
              </xsl:for-each>
            </tbody>
          </table>
        </main>
        <footer>
          <p>© Faulter Media · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a></p>
        </footer>
      </body>
    </html>
  </xsl:template>

  <xsl:template name="url-row">
    <tr>
      <td><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td>
      <td class="date-cell">
        <xsl:if test="sitemap:lastmod">
          <xsl:value-of select="substring(sitemap:lastmod, 1, 10)"/>
        </xsl:if>
      </td>
      <td>
        <xsl:variable name="freq" select="sitemap:changefreq"/>
        <span>
          <xsl:attribute name="class">
            <xsl:choose>
              <xsl:when test="$freq = 'daily'">badge badge-daily</xsl:when>
              <xsl:when test="$freq = 'weekly'">badge badge-weekly</xsl:when>
              <xsl:when test="$freq = 'monthly'">badge badge-monthly</xsl:when>
              <xsl:otherwise>badge badge-yearly</xsl:otherwise>
            </xsl:choose>
          </xsl:attribute>
          <xsl:value-of select="$freq"/>
        </span>
      </td>
      <td>
        <div class="priority-bar">
          <div class="priority-track">
            <div class="priority-fill">
              <xsl:attribute name="style">width: <xsl:value-of select="number(sitemap:priority) * 100"/>%</xsl:attribute>
            </div>
          </div>
          <span class="priority-num"><xsl:value-of select="sitemap:priority"/></span>
        </div>
      </td>
    </tr>
  </xsl:template>

</xsl:stylesheet>
