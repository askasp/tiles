import { record, records, text, webURL, type CodeConnector } from './types'

/** GitHub: pull requests from search; they open on github.com, where you review. */
export const githubConnector: CodeConnector = {
  hint: 'Pull requests to review',
  definition: {
    version: 1, id: 'github', name: 'GitHub', baseURL: 'https://api.github.com',
    auth: { type: 'bearer', help: 'GitHub → Settings → Developer settings → Fine-grained tokens, with Pull requests: read on the repositories you review.' },
    operations: [{ id: 'pulls', label: 'Search pull requests', method: 'GET', effect: 'read', path: '/search/issues', query: { q: 'is:pr {query}', per_page: '20', sort: 'updated', order: 'desc' } }],
    recipes: [{ id: 'pulls', label: 'Pull requests', shape: 'collection', view: 'list', operation: 'pulls', searchOperation: 'pulls', items: 'items', idField: 'id', titleField: 'title', subtitleField: 'repository_url', urlField: 'html_url', fields: [{ label: 'State', path: 'state', kind: 'badge' }] }],
  },
  filters: () => [{ title: 'Review requested', recipeID: 'pulls', query: '', ready: true }, { title: 'My open PRs', recipeID: 'pulls', query: 'is:open author:@me', ready: true }],
  async validate(context) { return text((await context.get('/user')).login) || 'GitHub token' },
  async read(_recipe, ref, _cursor, context) {
    let query = ref.query?.trim() || ''
    if (!query || /^(reviews?|review requested)$/i.test(query)) {
      const login = text((await context.get('/user', {}, 300_000)).login)
      if (!/^[a-z0-9-]+$/i.test(login)) throw new Error('GitHub did not name the account behind this token.')
      query = `is:open review-requested:${login}`
    }
    const data = await context.get('/search/issues', { q: `is:pr ${query}`, per_page: '20', sort: 'updated', order: 'desc' })
    const items = records(data.items, 20).flatMap(item => {
      const url = webURL(item.html_url, ['github.com'])
      if (!url || !/^\/[^/]+\/[^/]+\/pull\/\d+/.test(new URL(url).pathname)) return []
      const repository = new URL(url).pathname.split('/').slice(1, 3).join('/')
      return [{ id: url, title: `#${Number(item.number)} · ${text(item.title, 300)}`, subtitle: `${repository} · ${text(record(item.user).login)}`, text: '', url, time: text(item.updated_at) || undefined, fields: [{ label: 'State', value: text(item.state), kind: 'badge' as const }] }]
    })
    return { items, messages: [] }
  },
}
