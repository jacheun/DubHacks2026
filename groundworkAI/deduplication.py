"""Match repeated boxes within one source image; never merge by camera location."""


def normalized_box(issue):
    box = issue.get('bbox')
    width, height = issue.get('imageWidth'), issue.get('imageHeight')
    if not box or len(box) != 4 or not width or not height:
        return None
    return [box[0] / width, box[1] / height, box[2] / width, box[3] / height]


def same_defect(first, second):
    if not first.get('sourceImageId') or first.get('sourceImageId') != second.get('sourceImageId'):
        return False
    if first.get('type') != second.get('type'):
        return False
    a, b = normalized_box(first), normalized_box(second)
    if a is None or b is None:
        return False
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area_a = max(0, a[2]-a[0]) * max(0, a[3]-a[1])
    area_b = max(0, b[2]-b[0]) * max(0, b[3]-b[1])
    if min(area_a, area_b) <= 0:
        return False
    return intersection / (area_a + area_b - intersection) >= 0.55 or intersection / min(area_a, area_b) >= 0.85


def deduplicate(issues):
    # Keep reviewed/work-order records ahead of unreviewed model candidates.
    ordered = sorted(issues, key=lambda issue: (
        issue.get('reviewStatus', 'Pending') != 'Pending',
        bool(issue.get('workOrderId')),
        issue.get('confidence') or 0,
    ), reverse=True)
    result = []
    for issue in ordered:
        match = next((existing for existing in result if same_defect(existing, issue)
                      and not (existing.get('reviewStatus', 'Pending') != 'Pending'
                               and issue.get('reviewStatus', 'Pending') != 'Pending'
                               and existing.get('reviewStatus') != issue.get('reviewStatus'))), None)
        if match is None:
            result.append({**issue, 'duplicateIssueIds': []})
        else:
            match['duplicateIssueIds'].append(issue['id'])
    return result
