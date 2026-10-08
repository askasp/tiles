import type { FrontIdentity } from './types'

/** Personal filters for the Front connector. */

export function frontIdentity(value?: FrontIdentity): FrontIdentity {
  const email = value?.email?.trim() || '', teammateID = value?.teammateID?.trim() || '', tagID = value?.tagID?.trim() || ''
  if (email && (email.length > 320 || !/^[^\s:"<>@]+@[^\s:"<>@]+\.[^\s:"<>@]+$/.test(email))) throw new Error('Enter a normal email address for Front filters')
  if (teammateID && !/^tea_[a-z0-9]+$/i.test(teammateID)) throw new Error('Front teammate IDs start with tea_')
  if (tagID && !/^tag_[a-z0-9]+$/i.test(tagID)) throw new Error('Front tag IDs start with tag_')
  return { email, teammateID, tagID }
}
export function frontFilters(identity?: FrontIdentity) {
  return [
    { title: 'Open mail', query: 'is:open', ready: true },
    { title: 'Addressed to me', query: `to:${identity?.email || ''}`, ready: !!identity?.email },
    { title: 'Assigned to me', query: `assignee:${identity?.teammateID || ''}`, ready: !!identity?.teammateID },
    { title: 'Mentions', query: `mention:${identity?.teammateID || ''}`, ready: !!identity?.teammateID },
    { title: 'Tagged', query: `tag:${identity?.tagID || ''}`, ready: !!identity?.tagID },
    { title: 'Replies to my mail', query: `author:${identity?.teammateID || ''} is:unreplied`, ready: !!identity?.teammateID },
  ]
}
