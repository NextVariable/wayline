/** Public queries only. Credentials and provider error bodies never leave the server. */
export function createPublicSearch({ apiKey = '', tavilyKey = '', keyless = false, fetchImpl = fetch } = {}) {
  return async query => {
    if (!keyless && !apiKey && !tavilyKey) throw new Error('公开资料搜索尚未配置');
    if (typeof query !== 'string' || !query.trim() || query.length > 240) throw new Error('公开资料查询无效');
    const params = new URLSearchParams({ q: query, count: '4', search_lang: 'zh-hans' });
    const response = (keyless || tavilyKey) ? await fetchImpl('https://api.tavily.com/search', {method:'POST',headers:{...(keyless ? {'X-Tavily-Access-Mode':'keyless'} : {Authorization:`Bearer ${tavilyKey}`}), 'Content-Type':'application/json'},body:JSON.stringify({query,max_results:4,search_depth:'basic',include_raw_content:false}),signal:AbortSignal.timeout(7000)}) : await fetchImpl('https://api.search.brave.com/res/v1/web/search?' + params, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey }, signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('公开资料搜索暂不可用');
    const raw = await response.json();
    const results=(keyless || tavilyKey)?raw.results:raw.web?.results;
    return (Array.isArray(results) ? results : []).slice(0, 4).flatMap(hit => {
      try {
        const url = new URL(hit.url);
        if (url.protocol !== 'https:' || url.username || url.password || typeof hit.title !== 'string') return [];
        return [{ title: hit.title.slice(0, 200), url: url.href }];
      } catch { return []; }
    });
  };
}
