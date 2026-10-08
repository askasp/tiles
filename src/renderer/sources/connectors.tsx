import { recipeTile } from '../../shared/tiles'
import type { ConnectorInfo } from '../../shared/connectors'
import { api } from '../data'
import { RecipeBody } from '../RecipeTiles'
import { source } from './types'

const collections = (c: ConnectorInfo) => c.definition.recipes.filter(r => r.shape === 'collection' && !c.definition.operations.find(op => op.id === r.operation)?.path.includes('{parent}'))
/** Connectors K built (or you wrote): generated list, record, conversation… tiles. */
export const connectorsSource = source<{ connectors: ConnectorInfo[] }>({
  id: 'connectors', badge: 'connector', kinds: ['recipe'],
  use: env => ({ connectors: env.connectors }),
  added: state => state.connectors.length > 0,
  scopes: state => state.connectors.map(c => ({ id: `connector:${c.definition.id}`, name: c.definition.name })),
  status: state => state.connectors.map(c => ({ key: c.definition.id, name: c.definition.id, ok: c.hasToken || c.definition.auth.type === 'none', label: `${c.definition.name} source` })),
  candidates: (q, state) => state.connectors.flatMap(c => collections(c).map(r => { const input = recipeTile({ connectorID: c.definition.id, recipeID: r.id }, r.label, r, c.definition.name); return { input, score: q.rank(`${input.title} ${c.definition.name}`) } })),
  search(q, state) {
    if (q.text.length < 2 || !state.connectors.length || (q.scope && !q.scope.startsWith('connector:'))) return undefined
    return api.searchConnectors(q.text, q.scope?.slice(10)).then(result => result.resources.flatMap(resource => {
      const connector = state.connectors.find(c => c.definition.id === resource.ref.connectorID)
      const recipe = connector?.definition.recipes.find(r => r.id === resource.ref.recipeID)
      return connector && recipe ? [{ input: recipeTile(resource.ref, resource.title, recipe, connector.definition.name), score: 100 }] : []
    }))
  },
  Settings: ({ state, env }) => <>{state.connectors.map(c => <div className="source-row" key={c.definition.id}><span className="k-icon k-icon-connector md" aria-hidden>◇</span><span><strong>{c.definition.name}</strong><small>{c.definition.baseURL} · v{c.revision} · {c.hasToken ? 'connected' : c.definition.auth.type === 'none' ? 'no auth' : 'needs a token'}</small></span><em>generated</em><button className="text-button" onClick={() => env.editConnector({ id: c.definition.id })}>Mapping & auth</button></div>)}</>,
  Tile: ({ tile, state, env, visible }) => <RecipeBody tile={tile} connectors={state.connectors} visible={visible} open={env.open} change={patch => env.changeTile(tile.id, patch)} settings={() => env.editConnector({ id: tile.resource?.connectorID })} />,
})
