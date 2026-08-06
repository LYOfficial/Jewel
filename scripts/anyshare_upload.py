#!/usr/bin/env python3
"""Small AnyShare upload and connection-check bridge for Jewel backups."""

import argparse
from urllib.parse import urlparse


def find_folder(client, root_id, relative_path):
    current_id = root_id
    for segment in [part for part in relative_path.strip('/').split('/') if part]:
        content = client.browse_folder(current_id)
        match = next((item for item in content.dirs if item.name == segment), None)
        if match is None:
            raise RuntimeError(f'AnyShare folder not found: {segment}')
        current_id = match.id
    return current_id


def main():
    parser = argparse.ArgumentParser(description='Access an AnyShare public share for Jewel backups')
    parser.add_argument('--link', required=True)
    parser.add_argument('--file')
    parser.add_argument('--path', default='')
    parser.add_argument('--base-url', default='')
    parser.add_argument('--check', action='store_true', help='Only verify that the target folder can be listed')
    args = parser.parse_args()

    if not args.check and not args.file:
        parser.error('--file is required unless --check is used')

    try:
        from anyshare_unofficial import AnonymousClient, OnDup
    except ImportError as exc:
        raise SystemExit('anyshare-unofficial is not installed') from exc

    parsed = urlparse(args.link)
    base_url = args.base_url or f'{parsed.scheme}://{parsed.netloc}'
    client = AnonymousClient(args.link, base_url=base_url)
    try:
        root = client.get_first_entry()
        target_id = find_folder(client, root.id, args.path) if args.path else root.id
        if args.check:
            client.browse_folder(target_id)
            print('AnyShare connection check succeeded')
        else:
            client.upload_file(args.file, target_id, ondup=OnDup.OVERWRITE)
    finally:
        client.close()


if __name__ == '__main__':
    main()
