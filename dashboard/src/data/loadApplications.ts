import { buildApplications } from '../domain/applications'

const APPLICATIONS_ROOT = '../../../applications/'

const rawFiles = import.meta.glob<string>('../../../applications/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const files = Object.fromEntries(
  Object.entries(rawFiles).map(([path, content]) => [path.slice(APPLICATIONS_ROOT.length), content]),
)

export const { applications, errors } = buildApplications(files)

export function findApplication(slug: string | undefined) {
  return applications.find((application) => application.slug === slug)
}
