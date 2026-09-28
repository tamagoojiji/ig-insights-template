import os
import unittest

# config.py は ACCOUNT / BUSINESS_ID / ASSET_ID が必須なので、パーサのテスト用にダミーを入れてから import する
for _k in ('ACCOUNT', 'BUSINESS_ID', 'ASSET_ID'):
    os.environ.setdefault(_k, 'test')

from scrape import parse_detail, parse_female_pct, parse_follow_split, parse_top_age

REEL_TEXT = (
    '閲覧数\n合計\nオーディエンス\nフォロワー 6,123 フォロワー以外 8,708\n'
    '年齢と性別\n女性 95%\n男性 5%\n'
    '18-24 25-34 35-44 45-54 55-64 65+\n'
    '女性 2.6 16.7 31.9 21.1 15.9 6.8\n'
    '男性 0.2 0.7 1.3 1.2 1.1 0.5\n'
)

# 実ページ（2026-09-27 dump）: 軸ラベルが改行区切りで並んだ後、タブ区切りの表が続く
REEL_REAL = (
    'オーディエンス\n18-24\n25-34\n35-44\n45-54\n55-64\n65+\n0%\n10%\n20%\n30%\n40%\n'
    '\t18-24\t25-34\t35-44\t45-54\t55-64\t65+\n'
    '女性\t2.6\t16.7\t31.9\t21.1\t15.9\t6.8\n'
    '男性\t0.2\t0.7\t1.3\t1.2\t1.1\t0.5\n\u200b\n女性\n95%\n\u200b\n男性\n5%\n'
)
STORY_REAL = (
    'フォロワー\n8,738\nフォロワー以外\n10\n6,656\nオーディエンス\n25-34\n35-44\n45-54\n55-64\n65+\n0%\n20%\n40%\n'
    '\t25-34\t35-44\t45-54\t55-64\t65+\n'
    '女性\t17.5\t46.5\t20\t12\t4\n'
    'このストーリーズは、あなたの最近のInstagram ストーリーズと比較して、インタラクションが増加という結果になりました。\n'
)


class ParseTest(unittest.TestCase):
    def test_follow_split_space(self):
        self.assertEqual(parse_follow_split('フォロワー 6,123 フォロワー以外 8,708'), (6123, 8708))

    def test_follow_split_newlines(self):
        self.assertEqual(parse_follow_split('フォロワー\n8,736\nフォロワー以外\n10'), (8736, 10))

    def test_follow_split_missing(self):
        self.assertEqual(parse_follow_split('閲覧数 14,831'), (None, None))

    def test_female_pct(self):
        self.assertEqual(parse_female_pct('女性 95%'), 95)
        self.assertIsNone(parse_female_pct('女性 2.6 16.7 31.9'))

    def test_top_age_with_gender(self):
        self.assertEqual(parse_top_age(REEL_TEXT), '35-44 (33%)')

    def test_top_age_labels_only(self):
        self.assertEqual(parse_top_age('18-24 25-34 35-44 45-54 55-64 65+'), '')

    def test_detail_reel(self):
        self.assertEqual(parse_detail(REEL_TEXT), {
            'followers': 6123, 'nonFollowers': 8708, 'femalePct': 95, 'topAge': '35-44 (33%)'})

    def test_detail_story_without_gender(self):
        d = parse_detail('フォロワー\n8,736\nフォロワー以外\n10\n18-24\n25-34\n35-44\n45-54\n55-64\n65+')
        self.assertEqual((d['followers'], d['nonFollowers'], d['femalePct']), (8736, 10, None))

    def test_real_reel(self):
        self.assertEqual(parse_top_age(REEL_REAL), '35-44 (33%)')
        self.assertEqual(parse_female_pct(REEL_REAL), 95)

    def test_real_story_five_bands_female_only(self):
        self.assertEqual(parse_detail(STORY_REAL), {
            'followers': 8738, 'nonFollowers': 10, 'femalePct': None, 'topAge': '35-44 (47%)'})

    def test_man_count(self):
        self.assertEqual(parse_follow_split('フォロワー\n1.2万\nフォロワー以外\n8,708'), (12000, 8708))


if __name__ == '__main__':
    unittest.main()
