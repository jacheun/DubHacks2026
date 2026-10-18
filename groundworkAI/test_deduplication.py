import unittest

from deduplication import deduplicate, same_defect


def issue(identifier, box, **changes):
    return {'id': identifier, 'sourceImageId': '123', 'type': 'Pothole',
            'bbox': box, 'imageWidth': 100, 'imageHeight': 100,
            'confidence': .8, 'reviewStatus': 'Pending', **changes}


class DeduplicationTests(unittest.TestCase):
    def test_overlapping_boxes_merge_but_distinct_defects_remain(self):
        rows = deduplicate([issue('a', [0, 0, 40, 40]), issue('b', [1, 1, 41, 41]),
                            issue('c', [60, 60, 90, 90])])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['duplicateIssueIds'], ['b'])

    def test_review_decision_wins_over_confidence(self):
        rows = deduplicate([issue('a', [0, 0, 40, 40], confidence=.99),
                            issue('b', [0, 0, 40, 40], confidence=.6, reviewStatus='Rejected')])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['id'], 'b')
        self.assertEqual(rows[0]['reviewStatus'], 'Rejected')

    def test_conflicting_reviews_stay_separate(self):
        rows = deduplicate([issue('a', [0, 0, 40, 40], reviewStatus='Verified'),
                            issue('b', [0, 0, 40, 40], reviewStatus='Rejected')])
        self.assertEqual(len(rows), 2)

    def test_different_classes_and_images_stay_separate(self):
        a = issue('a', [0, 0, 40, 40])
        self.assertFalse(same_defect(a, issue('b', [0, 0, 40, 40], type='Transverse Crack')))
        self.assertFalse(same_defect(a, issue('b', [0, 0, 40, 40], sourceImageId='456')))

    def test_different_image_resolutions_match(self):
        self.assertTrue(same_defect(issue('a', [10, 10, 40, 40]),
                                   issue('b', [20, 20, 80, 80], imageWidth=200, imageHeight=200)))
