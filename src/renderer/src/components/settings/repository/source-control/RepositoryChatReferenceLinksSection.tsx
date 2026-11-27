import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { Repo } from '../../../../../../shared/repository/repo-types'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { SettingsSwitchRow } from '../../form-controls/SettingsFormControls'
import type { SettingsSearchEntry } from '../../search/settings-search'
import { searchKeywordTranslator } from '../../search/settings-search-keywords'

export function getRepositoryChatReferenceLinksSearchEntry(
  t: Translate = translate
): SettingsSearchEntry {
  const keyword = searchKeywordTranslator(t)
  return {
    title: t('components.RepositoryChatReferenceLinksSection.title', 'Link bare #numbers in chat'),
    description: t(
      'components.RepositoryChatReferenceLinksSection.description',
      'In chat, #123 and PR #123 link to this project’s GitHub repository. Turn this off when agents here work across several repositories. owner/repo#123 always links.'
    ),
    keywords: [
      ...keyword('components.RepositoryChatReferenceLinksSection.keywordIssue', 'issue link'),
      ...keyword(
        'components.RepositoryChatReferenceLinksSection.keywordPullRequest',
        'pull request'
      )
    ]
  }
}

export function RepositoryChatReferenceLinksSection({
  repo,
  updateRepo
}: {
  repo: Repo
  updateRepo: (
    repoId: string,
    updates: Pick<Repo, 'linkBareReferencesInChat'>
  ) => void | Promise<boolean>
}): React.JSX.Element {
  const t = useTranslate()
  const entry = getRepositoryChatReferenceLinksSearchEntry(t)
  const checked = repo.linkBareReferencesInChat !== false
  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      // The name and path keep this row visible on a project-name search.
      keywords={[repo.displayName, repo.path, ...(entry.keywords ?? [])]}
    >
      <SettingsSwitchRow
        label={entry.title}
        description={entry.description}
        checked={checked}
        onChange={() => void updateRepo(repo.id, { linkBareReferencesInChat: !checked })}
      />
    </SearchableSetting>
  )
}
