import argparse

from rpdk.typescript.parser import setup_subparser


def test_setup_subparser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="subparser_name")

    sub_parser = setup_subparser(subparsers, [])

    args = sub_parser.parse_args([])
    assert args.language == "typescript"
    assert args.use_docker is False

    short_args = sub_parser.parse_args(["-d"])
    assert short_args.language == "typescript"
    assert short_args.use_docker is True

    long_args = sub_parser.parse_args(["--use-docker"])
    assert long_args.language == "typescript"
    assert long_args.use_docker is True
