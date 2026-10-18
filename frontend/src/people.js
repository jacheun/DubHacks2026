export const PEOPLE = [
  {
    id: 'maya',
    name: 'Maya Chen',
    role: 'reviewer',
    title: 'Reviewer',
    summary: 'Verify detections. A coordinator can open a work order after you mark an issue Verified.',
  },
  {
    id: 'jordan',
    name: 'Jordan Hale',
    role: 'coordinator',
    title: 'Coordinator',
    summary: 'Create work orders from verified issues and assign them to the crew.',
  },
  {
    id: 'alex',
    name: 'Alex Rivera',
    role: 'crew',
    title: 'Crew',
    summary: 'View the work orders assigned to you and update their progress.',
  },
]

export const CREW = PEOPLE.filter(person => person.role === 'crew')

const STORAGE_KEY = 'groundwork-person'

export function loadPerson() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return PEOPLE.find(person => person.id === saved?.id) ?? PEOPLE[0]
  } catch {
    return PEOPLE[0]
  }
}

export function savePerson(person) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: person.id }))
}

export function actorHeaders(person, json = true) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-Groundwork-Role': person.role,
    'X-Groundwork-Name': person.name,
  }
}
