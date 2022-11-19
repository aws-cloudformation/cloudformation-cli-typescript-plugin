import argparse

import pytest
from rpdk.typescript.parser import setup_subparser


def test_setup_subparser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="subparser_name")

    sub_parser = setup_subparser(subparsers, [])

    args = sub_parser.parse_args([])
    assert args.language == "typescript"
    assert args.use_docker is False
    assert args.no_docker is False

    short_args = sub_parser.parse_args(["-d"])
    assert short_args.language == "typescript"
    assert short_args.use_docker is True
    assert short_args.no_docker is False

    long_args = sub_parser.parse_args(["--use-docker"])
    assert long_args.language == "typescript"
    assert long_args.use_docker is True
    assert long_args.no_docker is False

    no_docker = sub_parser.parse_args(["--no-docker"])
    assert no_docker.language == "typescript"
    assert no_docker.use_docker is False
    assert no_docker.no_docker is True

    with pytest.raises(SystemExit):
        sub_parser.parse_args(["--no-docker", "--use-docker"])
