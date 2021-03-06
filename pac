#!/usr/bin/env python3

"""
pac - wrapper around pacaur to mimic yaourts search feature

Usage:
    pac <searchpattern>
"""

__author__ = 'Ricardo Band'
__copyright__ = 'Copyright 2017, Ricardo band'
__credits__ = ['Ricardo Band', 'spacekookie']
__license__ = 'MIT'
__version__ = '1.3.5'
__maintainer__ = 'Ricardo Band'
__email__ = 'email@ricardo.band'

import os
import re
import sys
from typing import List
from subprocess import call, run, PIPE


_CEND: str = '\33[0m'
_CBOLD: str = '\33[1m'
_CGREEN2: str = '\33[1;32m'
_CYELLOW2: str = '\33[1;33m'
_CYELLOW3: str = '\33[7;33m'
_CBLUE2: str = '\33[1;34m'
_CVIOLET2: str = '\33[1;35m'


class UserQuit(Exception):
    pass


def search(search_term: str) -> List[dict]:
    """
    Search for the given terms using pacaur and return the results. The output of pacaur contains two
    different type of lines, for results from repo:
    repo/package_name version (group) [installed: version]
    for results from AUR:
    aur/package_name version (vote, popularity) [installed: version]

    A result consists of 2 lines. The second one is the package description. The first one goes like
    this (paranthesis means optional):
    repo/package_name version [package_group] [installed_state] [votes]

    - repo is the name of the repository and can be any string configured in /etc/pacman.conf like 'core',
    'extra', 'aur', 'myrepo'
    - package name is the identifiing string of the package
    - version can be any string but will most likely be something like 1.2.3-2
    - package group is a string in brackets
    - if the package is already installed the line has the string '[installed]' in it
    - if the repo is the aur the line will have the votes which look like '(252, 3.70)'

    The important part here is the package name because we need that to install the packages afterwards.
    We also put everything else in a dict to make the output more colorful.
    """
    result: List[dict] = []
    entry: dict = {}
    env: dict = dict(os.environ)

    env['LC_ALL'] = 'C'
    out: str = run(['pacaur', '-Ss', search_term], env=env, stdout=PIPE).stdout.decode()

    package_pattern = re.compile(
        r'''^(?P<repo>\S+)/(?P<package>\S+)\s(?P<version>\S+)  # extra/telepathy-kde-desktop-applets 16.12.3-1
            (\s                # optional group or votes
                (?P<group_or_votes>\(.+\))  # (kde-applications kdenetwork telepathy-kde) or (1, 0.01)
            )?
            (\s
                (?P<installed>\[installed.*\])
            )?
            ''', re.VERBOSE)
    for line in out.split('\n'):
        if not line:
            continue
        match = package_pattern.match(line)
        if match is None:
            entry['description'] = line.strip()
            result.append(entry)
            # create a new entry
            entry = {}
        else:
            entry.update(match.groupdict())
            # special handling for group_or_votes
            entry['votes'] = entry['group'] = None
            if entry['repo'] == 'aur':
                entry['votes'] = entry.pop('group_or_votes', None)
            else:
                entry['group'] = entry.pop('group_or_votes', None)
    return result


def present(entries: List[dict]):
    """
    Present the list of entries with numbers in front of it. For each package it displays 2 lines like this:

    1 extra/gvfs-mtp 1.30.3-1 (gnome) [installed]
        Virtual filesystem implementation for GIO (MTP backend; Android, media player)
    2 community/android-file-transfer 3.0-2
        Android MTP client with minimalistic UI
    3 aur/android-studio 2.2.3.0-1 [installed] (626, 22.50)
        The official Android IDE (Stable branch)
    4 aur/android-ndk r13b-1 (252, 3.70)
        Android C/C++ developer kit

    After that, a prompt will be printed but this is the task for another function.
    """
    for index, entry in enumerate(entries):
        padding = ' ' * len(str(index + 1))
        print(f"{_CYELLOW3}{index + 1}{_CEND} "
              f"{_CVIOLET2}{entry['repo']}/{_CEND}"
              f"{_CBOLD}{entry['package']}{_CEND} "
              f"{_CGREEN2}{entry['version']}{_CEND}",
              end='')
        if entry['group']:
            print(f" {_CBLUE2}{entry['group']}{_CEND}", end='')
        if entry['installed']:
            print(f" {_CYELLOW3}{_CBOLD}{entry['installed']}{_CEND}", end='')
        if entry['votes']:
            print(f" {_CYELLOW3}{_CBOLD}{entry['votes']}{_CEND}", end='')
        print(f"\n{padding}   {entry['description']}")
    print(f'{_CYELLOW2}==>{_CEND} {_CBOLD}Enter n° of packages to be installed (ex: 1 2 3 or 1-3){_CEND}')
    print(f'{_CYELLOW2}==>{_CEND} {_CBOLD}-------------------------------------------------------{_CEND}')


def parse_num(numbers: str) -> List[int]:
    """
    Takes a string like '1 2 3 6-8' and finds out which numbers the user wants. In this case 1,2,3,6,7,8.
    It can detect single digits or ranges seperated by space. A range must be given as from-to, where 'from'
    is always smaller than 'to'.
    """
    result = []
    for n in numbers.split(' '):
        if '-' in n:
            start, end = n.split('-')
            if not (start.isdecimal() and end.isdecimal()):
                raise ValueError(f'{start} or {end} is not a number')
            result.extend(range(int(start) - 1, int(end)))
        elif n.isdecimal():
            result.append(int(n) - 1)
        else:
            raise ValueError

    return result


def prompt() -> List[int]:
    """
    Print a prompt and finds out which numbers the user wants. The input should be in the form of '1 2 3 6-8',
    which means 1,2,3,6,7,8. It can detect single digits or ranges seperated by space. A range must be given
    as from-to, where 'from' is always smaller than 'to'.
    """
    while True:
        try:
            raw = input(f'{_CYELLOW2}==>{_CEND} ')
            return parse_num(raw)
        except (ValueError, EOFError):
            raise UserQuit


def install(numbers: List[int], packages: List[dict]):
    """
    Gets the chosen packages and concatinates them. Then executes the pacaur command with the packages to
    install them.
    """
    names = [packages[i]['package'] for i in numbers]
    call(f'pacaur -S {" ".join(names)}', shell=True)


def autoremove():
    """
    """
    orphans: List[str] = run(['pacaur', '-Qdtq'], stdout=PIPE).stdout.decode().split('\n')
    if orphans != ['', ]:
        call(f'pacaur -Rs {" ".join(orphans)}', shell=True)


if __name__ == '__main__':
    try:
        if len(sys.argv) > 1:
            if '-h' in sys.argv[1:] or '--help' in sys.argv[1:]:
                print(('pac - wrapper around pacaur to mimic yaourts search feature\n'
                       '\n'
                       'Usage:\n'
                       '    pac\n'
                       '    pac <search_pattern>\n'
                       '    pac (-a | --autoremove)\n'
                       '    pac (-h | --help)\n'
                       '    pac <pacaur_arguments>\n'
                       '\n'
                       'Options:\n'
                       '-a, --autoremove    Removes orphan packages.\n'
                       '-h, --help          Shows this help.\n'
                       '\n'
                       'Invoking pac without arguments is equivalent to `pacaur -Syu`.\n'
                       '\n'
                       'MIT licensed\n'
                       'https://github.com/XenGi/pac\n'))
            elif '-a' in sys.argv[1:] or '--autoremove' in sys.argv[1:]:
                # TODO: add warning
                autoremove()
            elif sys.argv[1][:2] in ['-D', '-F', '-Q', '-R', '-S', '-T', '-U']:
                call(f'pacaur {" ".join(sys.argv[1:])}', shell=True)
            else:
                entries = search(' '.join(sys.argv[1:]))
                if len(entries) > 0:
                    present(entries)
                    numbers = prompt()
                    install(numbers, entries)
                else:
                    print('Nothing found.')
        else:
            call('pacaur -Syu', shell=True)
    except (UserQuit, KeyboardInterrupt):
        pass
